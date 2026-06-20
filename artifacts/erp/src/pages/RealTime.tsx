import React, { useEffect, useState } from "react";
import { useGetAdminOrders, useGetAnalytics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLang } from "@/hooks/use-lang";
import { Activity, ShoppingCart, TrendingUp, Users, Clock, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  pending:    { bg: "bg-amber-100",  text: "text-amber-700",  icon: <Clock className="h-3.5 w-3.5" /> },
  processing: { bg: "bg-blue-100",   text: "text-blue-700",   icon: <RefreshCw className="h-3.5 w-3.5 animate-spin" /> },
  shipped:    { bg: "bg-indigo-100", text: "text-indigo-700", icon: <Activity className="h-3.5 w-3.5" /> },
  delivered:  { bg: "bg-emerald-100",text: "text-emerald-700",icon: <CheckCircle className="h-3.5 w-3.5" /> },
  cancelled:  { bg: "bg-red-100",    text: "text-red-700",    icon: <AlertCircle className="h-3.5 w-3.5" /> },
};

export default function RealTime() {
  const [, setTick] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  const { data: orders, refetch: refetchOrders } = useGetAdminOrders();
  const { data: analytics, refetch: refetchAnalytics } = useGetAnalytics();

  useEffect(() => {
    const id = setInterval(() => {
      setTick((tk) => tk + 1);
      setLastRefresh(new Date());
      refetchOrders();
      refetchAnalytics();
    }, 10000);
    return () => clearInterval(id);
  }, [refetchOrders, refetchAnalytics]);

  const recentOrders = [...(orders ?? [])]
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
    .slice(0, 15);

  const pendingCount = (orders ?? []).filter((o) => o.status === "pending").length;
  const processingCount = (orders ?? []).filter((o) => o.status === "processing").length;
  const deliveredCount = (orders ?? []).filter((o) => o.status === "delivered").length;

  const todayOrders = (orders ?? []).filter((o) => {
    if (!o.createdAt) return false;
    return new Date(o.createdAt).toDateString() === new Date().toDateString();
  });
  const todayRevenue = todayOrders.reduce((s, o) => s + parseFloat(o.totalAmount ?? "0"), 0);

  const kpis = [
    { labelFr: "Commandes aujourd'hui", labelAr: "طلبات اليوم", value: todayOrders.length, icon: ShoppingCart, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100" },
    { labelFr: "CA du jour", labelAr: "رقم أعمال اليوم", value: `${todayRevenue.toLocaleString("fr-DZ", { minimumFractionDigits: 0 })} ${currency}`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-100" },
    { labelFr: "En attente", labelAr: "في الانتظار", value: pendingCount, icon: Clock, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-100" },
    { labelFr: "Total commandes", labelAr: "إجمالي الطلبات", value: analytics?.totalOrders ?? 0, icon: Users, color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-100" },
  ];

  const statusPills = [
    { labelFr: "En attente", labelAr: "انتظار", count: pendingCount, color: "bg-amber-500" },
    { labelFr: "En cours", labelAr: "جارٍ", count: processingCount, color: "bg-blue-500" },
    { labelFr: "Livrées", labelAr: "مُسلَّمة", count: deliveredCount, color: "bg-emerald-500" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            {t("Temps Réel", "الوقت الفعلي")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("Mise à jour automatique toutes les 10 secondes · Dernière mise à jour:", "تحديث تلقائي كل 10 ثوانٍ · آخر تحديث:")}{" "}
            <span className="font-medium text-foreground">{format(lastRefresh, "HH:mm:ss")}</span>
          </p>
        </div>
        <button
          onClick={() => { refetchOrders(); refetchAnalytics(); setLastRefresh(new Date()); }}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors border rounded-md px-3 py-1.5"
        >
          <RefreshCw className="h-4 w-4" />
          {t("Actualiser", "تحديث")}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ labelFr, labelAr, value, icon: Icon, color, bg, border }) => (
          <Card key={labelFr} className={`border-2 ${border} ${bg}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t(labelFr, labelAr)}</p>
                  <p className={`text-2xl font-bold mt-1.5 ${color}`}>{value}</p>
                </div>
                <div className={`p-2 rounded-lg ${bg}`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        {statusPills.map(({ labelFr, labelAr, count, color }) => (
          <Card key={labelFr} className="flex-1 border shadow-sm text-center">
            <CardContent className="p-3">
              <div className={`w-10 h-10 rounded-full ${color} flex items-center justify-center mx-auto mb-2`}>
                <span className="text-white font-bold text-sm">{count}</span>
              </div>
              <p className="text-xs font-medium text-foreground">{t(labelFr, labelAr)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border shadow-sm">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-500" />
            {t("Activité récente", "النشاط الأخير")}
          </CardTitle>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {recentOrders.length} {t("commandes", "طلبات")}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {recentOrders.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t("Aucune activité", "لا يوجد نشاط")}</p>
              </div>
            ) : (
              recentOrders.map((order) => {
                const s = STATUS_COLORS[order.status ?? "pending"] ?? STATUS_COLORS["pending"];
                const timeSince = order.createdAt ? formatDistanceToNow(new Date(order.createdAt), { addSuffix: true }) : "—";
                return (
                  <div key={order.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="relative">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center">
                        <ShoppingCart className="h-4 w-4 text-slate-500" />
                      </div>
                      {order.status === "pending" && (
                        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white animate-pulse" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{t("Commande", "طلب")} #{String(order.id ?? "").slice(0, 8)}</p>
                        <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}>
                          {s.icon}
                          {order.status}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {order.shippingAddress
                          ? `${(order.shippingAddress as Record<string, string>)?.wilaya ?? ""} · ${(order.shippingAddress as Record<string, string>)?.name ?? ""}`.trim().replace(/^·\s*/, "")
                          : "—"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-primary">{parseFloat(order.totalAmount ?? "0").toLocaleString()} {currency}</p>
                      <p className="text-xs text-muted-foreground">{timeSince}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
