import React, { useState } from "react";
import {
  useGetProductProfitReport,
  useGetCustomerProfitReport,
  useGetSupplierReport,
  useGetMonthlyReport,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang } from "@/hooks/use-lang";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Legend,
} from "recharts";
import { Package, Users, Truck, TrendingUp, TrendingDown, CalendarDays } from "lucide-react";

const TODAY = new Date().toISOString().split("T")[0];
const MONTH_AGO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

const PRESETS = [
  { labelFr: "7 jours",   labelAr: "7 أيام",   days: 7 },
  { labelFr: "30 jours",  labelAr: "30 يومًا",  days: 30 },
  { labelFr: "90 jours",  labelAr: "90 يومًا",  days: 90 },
  { labelFr: "365 jours", labelAr: "365 يومًا", days: 365 },
];

function daysAgo(n: number) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

function MarginBadge({ margin }: { margin: number }) {
  const color = margin >= 30 ? "text-emerald-600 bg-emerald-50" :
                margin >= 10 ? "text-amber-600 bg-amber-50" :
                "text-red-500 bg-red-50";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded ${color}`}>
      {margin >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {margin.toFixed(1)}%
    </span>
  );
}

function fmt(v: number) {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function Reports() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  const [from, setFrom] = useState(MONTH_AGO);
  const [to, setTo] = useState(TODAY);
  const [activePreset, setActivePreset] = useState<number | null>(30);

  const applyPreset = (days: number) => {
    setFrom(daysAgo(days));
    setTo(TODAY);
    setActivePreset(days);
  };

  const params = { from, to };

  const { data: products, isLoading: loadingProducts } = useGetProductProfitReport(params as any);
  const { data: customers, isLoading: loadingCustomers } = useGetCustomerProfitReport(params as any);
  const { data: suppliers, isLoading: loadingSuppliers } = useGetSupplierReport(params as any);
  const { data: monthly, isLoading: loadingMonthly } = useGetMonthlyReport(params as any);

  const productRows = (products ?? []) as {
    id: number; nameEn: string; nameAr: string; reference?: string | null;
    costPrice?: number | null; stock: number; totalSold: number;
    totalRevenue: number; totalCogs: number; grossProfit: number; grossMargin: number;
  }[];

  const customerRows = (customers ?? []) as {
    id: number; name: string; email?: string | null; phone?: string | null;
    wilaya?: string | null; currentBalance: number; totalOrders: number;
    totalRevenue: number; totalCogs: number; grossProfit: number; grossMargin: number;
  }[];

  const supplierRows = (suppliers ?? []) as {
    id: number; name: string; contactName?: string | null; email?: string | null;
    phone?: string | null; currentBalance: number;
    totalPos: number; totalPurchased: number; totalReceived: number;
    distinctProducts: number; avgUnitCost: number;
  }[];

  const monthlyRows = (monthly ?? []) as {
    month: string; totalRevenue: number; totalCogs: number; totalRetours: number; totalExpenses: number;
    grossProfit: number; netProfit: number; grossMargin: number;
  }[];

  const topProducts = productRows.slice(0, 10);
  const topCustomers = customerRows.slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("Rapports de rentabilité", "تقارير الأرباح")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("Analyse des marges et des flux par période", "تحليل الهوامش والتدفقات حسب الفترة")}</p>
      </div>

      {/* Date Filter */}
      <Card className="border shadow-sm">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => applyPreset(p.days)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                    activePreset === p.days
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-foreground border-border hover:bg-muted"
                  }`}
                >
                  {t(p.labelFr, p.labelAr)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <label className="text-xs text-muted-foreground">{t("Du", "من")}</label>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => { setFrom(e.target.value); setActivePreset(null); }}
                className="text-xs border rounded px-2 py-1.5 bg-background text-foreground"
              />
              <label className="text-xs text-muted-foreground">{t("Au", "إلى")}</label>
              <input
                type="date"
                value={to}
                min={from}
                max={TODAY}
                onChange={(e) => { setTo(e.target.value); setActivePreset(null); }}
                className="text-xs border rounded px-2 py-1.5 bg-background text-foreground"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="monthly">
        <TabsList className="mb-4">
          <TabsTrigger value="monthly" className="gap-1.5">
            <CalendarDays className="h-4 w-4" />
            {t("Par mois", "شهرياً")}
          </TabsTrigger>
          <TabsTrigger value="products" className="gap-1.5">
            <Package className="h-4 w-4" />
            {t("Par produit", "حسب المنتج")}
          </TabsTrigger>
          <TabsTrigger value="customers" className="gap-1.5">
            <Users className="h-4 w-4" />
            {t("Par client", "حسب العميل")}
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="gap-1.5">
            <Truck className="h-4 w-4" />
            {t("Par fournisseur", "حسب المورد")}
          </TabsTrigger>
        </TabsList>

        {/* ── Monthly Tab ── */}
        <TabsContent value="monthly" className="space-y-4">
          {loadingMonthly ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <>
              {monthlyRows.length > 0 && (
                <Card className="border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{t("Évolution mensuelle — CA vs Bénéfice", "التطور الشهري — الإيراد مقابل الربح")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={monthlyRows} margin={{ left: 8, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmt(v)} />
                        <Tooltip
                          formatter={(v: number, name: string) => {
                            const labels: Record<string, string> = {
                              totalRevenue: t("Chiffre d'affaires", "الإيراد"),
                              grossProfit:  t("Bénéfice brut", "الربح الإجمالي"),
                              netProfit:    t("Bénéfice net", "الربح الصافي"),
                              totalExpenses: t("Charges", "المصاريف"),
                            };
                            return [`${fmt(v)} ${currency}`, labels[name] ?? name];
                          }}
                        />
                        <Legend
                          formatter={(value) => {
                            const labels: Record<string, string> = {
                              totalRevenue:  t("CA", "الإيراد"),
                              grossProfit:   t("Bénéf. brut", "الربح الإجمالي"),
                              netProfit:     t("Bénéf. net", "الربح الصافي"),
                              totalExpenses: t("Charges", "المصاريف"),
                            };
                            return labels[value] ?? value;
                          }}
                        />
                        <Bar dataKey="totalRevenue"  fill="hsl(var(--chart-1))" radius={[3,3,0,0]} />
                        <Bar dataKey="grossProfit"   fill="hsl(var(--chart-2))" radius={[3,3,0,0]} />
                        <Bar dataKey="totalExpenses" fill="hsl(var(--chart-5))" radius={[3,3,0,0]} />
                        <Bar dataKey="netProfit"     fill="hsl(var(--chart-3))" radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              <Card className="border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t("Détail mensuel", "التفصيل الشهري")}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">{t("Mois", "الشهر")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Chiffre d'affaires", "الإيراد")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("COGS", "تكلفة البضاعة")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Retours", "المرتجعات")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Bénéfice brut", "الربح الإجمالي")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Charges", "المصاريف")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Bénéfice net", "الربح الصافي")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Marge brute", "الهامش الإجمالي")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyRows.length === 0 && (
                          <tr>
                            <td colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                              {t("Aucune donnée pour cette période", "لا توجد بيانات لهذه الفترة")}
                            </td>
                          </tr>
                        )}
                        {monthlyRows.map((row) => (
                          <tr key={row.month} className="border-b hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5 font-medium">{row.month}</td>
                            <td className="px-4 py-2.5 text-right">{fmt(row.totalRevenue)} {currency}</td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt(row.totalCogs)} {currency}</td>
                            <td className="px-4 py-2.5 text-right text-amber-600">{fmt(row.totalRetours)} {currency}</td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${row.grossProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                              {fmt(row.grossProfit)} {currency}
                            </td>
                            <td className="px-4 py-2.5 text-right text-red-500">{fmt(row.totalExpenses)} {currency}</td>
                            <td className={`px-4 py-2.5 text-right font-bold ${row.netProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                              {fmt(row.netProfit)} {currency}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <MarginBadge margin={row.grossMargin} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Products Tab ── */}
        <TabsContent value="products" className="space-y-4">
          {loadingProducts ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <>
              {topProducts.length > 0 && (
                <Card className="border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{t("Top 10 — Bénéfice brut", "أعلى 10 — الربح الإجمالي")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={topProducts} layout="vertical" margin={{ left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmt(v)} />
                        <YAxis type="category" dataKey="nameEn" tick={{ fontSize: 10 }} width={90} />
                        <Tooltip
                          formatter={(v: number) => [`${fmt(Number(v))} ${currency}`, t("Bénéfice", "ربح")]}
                        />
                        <Bar dataKey="grossProfit" radius={[0, 3, 3, 0]}>
                          {topProducts.map((row, idx) => (
                            <Cell
                              key={idx}
                              fill={row.grossProfit >= 0 ? "hsl(var(--chart-1))" : "hsl(var(--chart-5))"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              <Card className="border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t("Détail par produit", "التفصيل حسب المنتج")}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">{t("Produit", "المنتج")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Vendu", "مباع")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Chiffre d'affaires", "الإيراد")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("COGS", "تكلفة البضاعة")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Bénéfice brut", "الربح الإجمالي")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Marge", "الهامش")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Stock", "المخزون")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {productRows.length === 0 && (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                              {t("Aucune donnée pour cette période", "لا توجد بيانات لهذه الفترة")}
                            </td>
                          </tr>
                        )}
                        {productRows.map((row) => (
                          <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{row.nameEn}</p>
                              <p className="text-xs text-muted-foreground" dir="rtl">{row.nameAr}</p>
                              {row.reference && <p className="text-xs text-muted-foreground">{row.reference}</p>}
                            </td>
                            <td className="px-4 py-2.5 text-right">{row.totalSold.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right font-medium">{fmt(row.totalRevenue)} {currency}</td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt(row.totalCogs)} {currency}</td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${row.grossProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                              {fmt(row.grossProfit)} {currency}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <MarginBadge margin={row.grossMargin} />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`text-xs font-medium ${row.stock < 5 ? "text-red-500" : "text-foreground"}`}>
                                {row.stock}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Customers Tab ── */}
        <TabsContent value="customers" className="space-y-4">
          {loadingCustomers ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <>
              {topCustomers.length > 0 && (
                <Card className="border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{t("Top 10 clients — Chiffre d'affaires", "أعلى 10 عملاء — الإيراد")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={topCustomers} layout="vertical" margin={{ left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmt(v)} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                        <Tooltip
                          formatter={(v: number) => [`${fmt(Number(v))} ${currency}`, t("Chiffre d'affaires", "الإيراد")]}
                        />
                        <Bar dataKey="totalRevenue" fill="hsl(var(--chart-2))" radius={[0, 3, 3, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              <Card className="border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t("Détail par client", "التفصيل حسب العميل")}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">{t("Client", "العميل")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Commandes", "الطلبات")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Chiffre d'affaires", "الإيراد")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("COGS", "تكلفة البضاعة")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Bénéfice brut", "الربح الإجمالي")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Marge", "الهامش")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Solde", "الرصيد")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerRows.length === 0 && (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                              {t("Aucun client enregistré pour cette période", "لا يوجد عملاء مسجلون لهذه الفترة")}
                            </td>
                          </tr>
                        )}
                        {customerRows.map((row) => (
                          <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{row.name}</p>
                              {row.email && <p className="text-xs text-muted-foreground">{row.email}</p>}
                              {row.wilaya && <p className="text-xs text-muted-foreground">{row.wilaya}</p>}
                            </td>
                            <td className="px-4 py-2.5 text-right">{row.totalOrders}</td>
                            <td className="px-4 py-2.5 text-right font-medium">{fmt(row.totalRevenue)} {currency}</td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground">{fmt(row.totalCogs)} {currency}</td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${row.grossProfit >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                              {fmt(row.grossProfit)} {currency}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <MarginBadge margin={row.grossMargin} />
                            </td>
                            <td className={`px-4 py-2.5 text-right font-medium ${row.currentBalance > 0 ? "text-red-500" : "text-emerald-600"}`}>
                              {fmt(row.currentBalance)} {currency}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ── Suppliers Tab ── */}
        <TabsContent value="suppliers" className="space-y-4">
          {loadingSuppliers ? (
            <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <>
              {supplierRows.length > 0 && (
                <Card className="border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{t("Achats par fournisseur", "المشتريات حسب المورد")}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={supplierRows.slice(0, 10)} layout="vertical" margin={{ left: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmt(v)} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                        <Tooltip
                          formatter={(v: number, name: string) => [
                            `${fmt(Number(v))} ${currency}`,
                            name === "totalPurchased" ? t("Total acheté", "إجمالي المشتريات") : t("Total reçu", "إجمالي المستلم"),
                          ]}
                        />
                        <Bar dataKey="totalPurchased" fill="hsl(var(--chart-3))" radius={[0, 3, 3, 0]} name="totalPurchased" />
                        <Bar dataKey="totalReceived" fill="hsl(var(--chart-4))" radius={[0, 3, 3, 0]} name="totalReceived" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              <Card className="border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t("Détail par fournisseur", "التفصيل حسب المورد")}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left px-4 py-2 font-medium text-muted-foreground">{t("Fournisseur", "المورد")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("BCs", "أوامر الشراء")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Produits distincts", "منتجات مختلفة")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Coût moy. unitaire", "متوسط سعر الوحدة")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Total acheté", "إجمالي المشتريات")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Total reçu", "إجمالي المستلم")}</th>
                          <th className="text-right px-4 py-2 font-medium text-muted-foreground">{t("Solde dû", "المبلغ المستحق")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierRows.length === 0 && (
                          <tr>
                            <td colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                              {t("Aucun fournisseur pour cette période", "لا يوجد موردون لهذه الفترة")}
                            </td>
                          </tr>
                        )}
                        {supplierRows.map((row) => (
                          <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{row.name}</p>
                              {row.contactName && <p className="text-xs text-muted-foreground">{row.contactName}</p>}
                              {row.phone && <p className="text-xs text-muted-foreground">{row.phone}</p>}
                            </td>
                            <td className="px-4 py-2.5 text-right">{row.totalPos}</td>
                            <td className="px-4 py-2.5 text-right">{row.distinctProducts}</td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground">
                              {row.avgUnitCost > 0 ? `${fmt(row.avgUnitCost)} ${currency}` : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right font-medium">{fmt(row.totalPurchased)} {currency}</td>
                            <td className="px-4 py-2.5 text-right text-emerald-600 font-medium">{fmt(row.totalReceived)} {currency}</td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${row.currentBalance > 0 ? "text-red-500" : "text-foreground"}`}>
                              {fmt(row.currentBalance)} {currency}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
