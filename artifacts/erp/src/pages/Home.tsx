import React from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { useMe } from "@/hooks/use-me";
import { usePermissions, type PermSection } from "@/hooks/use-permissions";
import { useStoreContext } from "@/hooks/use-store";
import {
  Package, ShoppingCart, FileText, Wallet,
  UserCheck, Truck, Users, LayoutDashboard,
  Activity, BarChart2, Clock, Calendar, CreditCard, ShoppingBasket,
  AlertTriangle, CheckCircle,
} from "lucide-react";

const _API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

type HomeModule = {
  labelFr: string;
  labelAr: string;
  href: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  color: string;
  section: PermSection;
};

const modules: HomeModule[] = [
  { labelFr: "Articles",        labelAr: "المنتجات",      href: "/products",        icon: Package,         color: "bg-cyan-500",    section: "products" },
  { labelFr: "Ventes",          labelAr: "المبيعات",      href: "/orders",          icon: ShoppingCart,    color: "bg-emerald-500", section: "orders" },
  { labelFr: "Achats",          labelAr: "المشتريات",     href: "/purchase-orders", icon: FileText,        color: "bg-rose-500",    section: "purchases" },
  { labelFr: "Besoin d'achats", labelAr: "ما ينقص",       href: "/smart-purchase",  icon: ShoppingBasket,  color: "bg-orange-500",  section: "purchases" },
  { labelFr: "Caisse",          labelAr: "الصندوق",       href: "/caisse",          icon: Wallet,          color: "bg-amber-500",   section: "caisse" },
  { labelFr: "Clients",         labelAr: "العملاء",       href: "/customers",       icon: UserCheck,       color: "bg-sky-500",     section: "customers" },
  { labelFr: "Fournisseurs",    labelAr: "الموردون",      href: "/suppliers",       icon: Truck,           color: "bg-violet-500",  section: "suppliers" },
  { labelFr: "Employés",        labelAr: "الموظفون",      href: "/employees",       icon: Users,           color: "bg-indigo-500",  section: "employees" },
  { labelFr: "Tableau de bord", labelAr: "لوحة التحكم",  href: "/dashboard",       icon: LayoutDashboard, color: "bg-slate-600",   section: "dashboard" },
  { labelFr: "Temps Réel",      labelAr: "الوقت الفعلي", href: "/realtime",        icon: Activity,        color: "bg-pink-500",    section: "realtime" },
  { labelFr: "Stock",           labelAr: "المخزون",       href: "/inventory",       icon: BarChart2,       color: "bg-blue-600",    section: "inventory" },
  { labelFr: "Présences",       labelAr: "الحضور",        href: "/attendance",      icon: Clock,           color: "bg-teal-500",    section: "attendance" },
  { labelFr: "Congés",          labelAr: "الإجازات",      href: "/leaves",          icon: Calendar,        color: "bg-orange-500",  section: "leaves" },
  { labelFr: "Comptabilité",    labelAr: "المحاسبة",      href: "/accounting",      icon: CreditCard,      color: "bg-fuchsia-500", section: "accounting" },
];

function useAlertsCount(enabled: boolean) {
  const { currentStoreId } = useStoreContext();
  return useQuery<{ crossStoreMissing: number; slowMovers: number }>({
    queryKey: ["alerts-count", currentStoreId],
    queryFn: async () => {
      const token = localStorage.getItem("midanic_token");
      const res = await fetch(`${_API}/api/erp/alerts/count`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return { crossStoreMissing: 0, slowMovers: 0 };
      return res.json() as Promise<{ crossStoreMissing: number; slowMovers: number }>;
    },
    enabled: enabled && !!currentStoreId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export default function Home() {
  const [, navigate] = useLocation();
  const { lang } = useLang();
  const { isAdmin } = useMe();
  const { can } = usePermissions();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  const canViewAlerts = isAdmin || can("inventory", "view");
  const { data: alertsData } = useAlertsCount(canViewAlerts);

  const visibleModules = isAdmin
    ? modules
    : modules.filter((m) => can(m.section, "view"));

  const missing = alertsData?.crossStoreMissing ?? 0;
  const slow    = alertsData?.slowMovers ?? 0;
  const total   = missing + slow;
  const hasAlerts = total > 0;

  return (
    <div className="min-h-screen bg-white">
      <div className="px-6 py-10 sm:py-14 max-w-5xl mx-auto space-y-10">

        {/* Alerts summary card — visible to anyone who can view inventory */}
        {canViewAlerts && alertsData !== undefined && (
          <button
            onClick={() => navigate("/alerts")}
            className={`w-full flex items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-colors focus:outline-none
              ${hasAlerts
                ? "border-orange-200 bg-orange-50 hover:bg-orange-100"
                : "border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
              }`}
          >
            <div
              className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center
                ${hasAlerts ? "bg-orange-500" : "bg-emerald-500"}`}
            >
              {hasAlerts
                ? <AlertTriangle className="h-5 w-5 text-white" strokeWidth={2} />
                : <CheckCircle   className="h-5 w-5 text-white" strokeWidth={2} />
              }
            </div>

            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-sm ${hasAlerts ? "text-orange-800" : "text-emerald-800"}`}>
                {t("Alertes stock", "تنبيهات المخزون")}
              </p>
              {hasAlerts ? (
                <p className="text-xs text-orange-700 mt-0.5">
                  {missing > 0 && (
                    <span>
                      {missing}&nbsp;{t("produit(s) absent(s)", missing === 1 ? "منتج غائب" : "منتجات غائبة")}
                    </span>
                  )}
                  {missing > 0 && slow > 0 && <span className="mx-1.5">·</span>}
                  {slow > 0 && (
                    <span>
                      {slow}&nbsp;{t("article(s) invendu(s)", slow === 1 ? "منتج راكد" : "منتجات راكدة")}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-emerald-700 mt-0.5">
                  {t("Aucune alerte en cours", "لا توجد تنبيهات حالياً")}
                </p>
              )}
            </div>

            {hasAlerts && (
              <span className="flex-shrink-0 bg-orange-500 text-white text-xs font-bold rounded-full min-w-[1.5rem] h-6 px-2 flex items-center justify-center">
                {total}
              </span>
            )}
          </button>
        )}

        {/* Module grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-10">
          {visibleModules.map(({ labelFr, labelAr, href, icon: Icon, color }) => (
            <button
              key={href}
              onClick={() => navigate(href)}
              className="group flex flex-col items-center gap-3 focus:outline-none"
              data-testid={`home-tile-${href.replace("/", "")}`}
            >
              <div
                className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full ${color} flex items-center justify-center group-hover:-translate-y-0.5 transition-transform duration-150`}
              >
                <Icon className="h-9 w-9 sm:h-10 sm:w-10 text-white" strokeWidth={1.75} />
              </div>
              <div className="text-center">
                <p className="font-medium text-gray-800 text-sm">{t(labelFr, labelAr)}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
