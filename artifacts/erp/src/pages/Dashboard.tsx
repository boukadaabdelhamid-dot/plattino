import React, { useState, useEffect, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/hooks/use-lang";
import { useAuth } from "@/hooks/use-auth";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import {
  LayoutDashboard, ShoppingCart, TrendingUp, Users,
  UserCog, Package, Wallet, Truck, AlertCircle, Loader2,
  Eye, ChevronUp, ChevronDown, ChevronsUpDown, Building2,
} from "lucide-react";

type TFn = (fr: string, ar: string) => string;

// ─── Shared number formatter ───────────────────────────────────────
function fmtNum(v: string | number | null | undefined, currency = "") {
  const n = Number(v ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const formatted = safe.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${formatted} ${currency}` : formatted;
}

// ─── KPI card ─────────────────────────────────────────────────────
interface KpiCardProps {
  icon: React.ElementType;
  labelFr: string;
  labelAr: string;
  value: string;
  t: TFn;
  onClick?: () => void;
  variant?: "default" | "positive" | "negative";
}

function KpiCard({ icon: Icon, labelFr, labelAr, value, t, onClick, variant = "default" }: KpiCardProps) {
  const valueColor =
    variant === "positive" ? "text-emerald-600" :
    variant === "negative" ? "text-destructive" :
    "text-foreground";
  return (
    <Card
      className={onClick ? "cursor-pointer hover:shadow-md hover:border-primary/30 transition-all" : ""}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {t(labelFr, labelAr)}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground/60 shrink-0" />
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold tracking-tight ${valueColor}`}>{value}</p>
        {onClick && (
          <p className="text-xs text-muted-foreground/60 mt-1">
            {t("Cliquer pour le détail", "انقر للتفاصيل")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function KpiCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-4 rounded" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-36" />
      </CardContent>
    </Card>
  );
}

// ─── Shared fetch hook ─────────────────────────────────────────────
function useFetch<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setError(null);
    const apiBase = ((import.meta.env.VITE_API_URL as string) ?? "").replace(/\/+$/, "");
    const token = localStorage.getItem("midanic_token");
    fetch(`${apiBase}${path}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then((r) => {
        if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`));
        return r.json() as Promise<T>;
      })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [path]);

  return { data, loading, error };
}

function useFetchList<T>(path: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setRows([]);
    setError(null);
    const apiBase = ((import.meta.env.VITE_API_URL as string) ?? "").replace(/\/+$/, "");
    const token = localStorage.getItem("midanic_token");
    fetch(`${apiBase}${path}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then((r) => {
        if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`));
        return r.json() as Promise<T[]>;
      })
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [path]);

  return { rows, loading, error };
}

// ─── Build path with optional storeId param ─────────────────────────
function buildPath(base: string, storeId?: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams(extra ?? {});
  if (storeId) params.set("storeId", storeId);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// ─── Decode JWT role from localStorage token (base64url-safe) ────
function getTokenRole(token: string | null): string | null {
  if (!token) return null;
  try {
    const segment = token.split(".")[1];
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
    return (JSON.parse(atob(padded)) as Record<string, unknown>).role as string ?? null;
  } catch { return null; }
}

// ─── Error / Empty states ──────────────────────────────────────────
function LoadingGrid({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => <KpiCardSkeleton key={i} />)}
    </div>
  );
}
function ErrorState({ t }: { t: TFn }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3 text-destructive">
      <AlertCircle className="h-8 w-8" />
      <p className="text-sm font-medium">{t("Erreur de chargement", "خطأ في التحميل")}</p>
    </div>
  );
}

// ─── Shared table ──────────────────────────────────────────────────
function SimpleTable({ headers, rows }: { headers: React.ReactNode[]; rows: React.ReactNode[][] }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            {headers.map((h, i) => (
              <th key={i} className="py-2.5 px-4 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="py-2.5 px-4">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────
type StockRow = { id: number; nameEn: string; nameAr: string; reference: string | null; stock: number; costPrice: string; valeur: string };
type ClientRow = { id: number; name: string; balance: string };
type SupplierRow = { id: number; name: string; balance: string };
type CaisseRow = { id: number; kind: string; balance: string; owner_name: string | null };
type CaissesData = { total: string; caisses: CaisseRow[] };
type VenteRow = { date: string; montant: string; reduction: string; marge: string; retours: string; charges: string; benefice: string };
type VentePlusRow = {
  id: number; designation: string; marque: string; famille: string;
  reference: string | null; barcode: string | null; stock: number;
  price: string | null; cost_price_product: string | null;
  qte_vendue: string; pu: string; montant: string; benefice: string;
};
type AccountingData = { totalIncome: number; totalExpense: number; netBalance: number; monthly: { month: string; income: string; expenses: string }[] };
type Employee = { id: number; name: string; position: string; salary: string; status: string };

// ─── Modals ───────────────────────────────────────────────────────
function ClientReceivablesModal({ open, onClose, rows, loading, error, currency, t }: {
  open: boolean; onClose: () => void; rows: ClientRow[]; loading: boolean; error: string | null; currency: string; t: TFn;
}) {
  const total = rows.reduce((s, r) => s + Number(r.balance ?? 0), 0);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-primary" />
            {t("Détail des Créances clients", "تفاصيل ذمم العملاء")}
          </DialogTitle>
        </DialogHeader>
        {loading && <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {!loading && error && <div className="flex items-center gap-2 text-destructive py-12 justify-center"><AlertCircle className="h-5 w-5" /><span className="text-sm">{error}</span></div>}
        {!loading && !error && rows.length === 0 && <p className="text-center text-muted-foreground text-sm py-16 px-6">{t("Aucun client avec un solde impayé.", "لا يوجد عميل لديه رصيد مستحق.")}</p>}
        {!loading && !error && rows.length > 0 && (
          <>
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10"><tr className="border-b">
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Client", "العميل")}</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Solde dû", "المبلغ المستحق")}</th>
                </tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="py-2.5 px-4 font-medium">{row.name}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold">{fmtNum(row.balance)} {currency}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="border-t px-6 py-4 flex items-center justify-between shrink-0 bg-muted/20">
              <span className="text-sm font-semibold text-muted-foreground">{t("Total", "الإجمالي")} ({rows.length} {t("client(s)", "عميل")})</span>
              <span className="text-xl font-bold tabular-nums">{fmtNum(total)} {currency}</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StockDetailModal({ open, onClose, currency, t, lang, storeId }: {
  open: boolean; onClose: () => void; currency: string; t: TFn; lang: string; storeId?: string;
}) {
  const { rows, loading, error } = useFetchList<StockRow>(buildPath("/api/erp/dashboard/stock-detail", storeId));
  const total = rows.reduce((s, r) => s + Number(r.valeur ?? 0), 0);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="h-5 w-5 text-primary" />
            {t("Détail du Stock courant", "تفاصيل قيمة المخزون")}
          </DialogTitle>
        </DialogHeader>
        {loading && <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {!loading && error && <div className="flex items-center gap-2 text-destructive py-12 justify-center"><AlertCircle className="h-5 w-5" /><span className="text-sm">{t("Erreur", "خطأ")}</span></div>}
        {!loading && !error && rows.length === 0 && <p className="text-center text-muted-foreground text-sm py-16 px-6">{t("Aucun produit.", "لا يوجد منتج.")}</p>}
        {!loading && !error && rows.length > 0 && (
          <>
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10"><tr className="border-b">
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground text-xs uppercase">{t("Produit", "المنتج")}</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground text-xs uppercase">{t("Réf.", "المرجع")}</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground text-xs uppercase">{t("Stock", "المخزون")}</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground text-xs uppercase">{t("Coût", "التكلفة")}</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground text-xs uppercase">{t("Valeur", "القيمة")}</th>
                </tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="py-2.5 px-4 font-medium">{lang === "ar" ? (row.nameAr || row.nameEn) : (row.nameEn || row.nameAr)}</td>
                    <td className="py-2.5 px-4 text-muted-foreground font-mono text-xs">{row.reference ?? "—"}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{row.stock}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{fmtNum(row.costPrice)} {currency}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold">{fmtNum(row.valeur)} {currency}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="border-t px-6 py-4 flex items-center justify-between shrink-0 bg-muted/20">
              <span className="text-sm font-semibold text-muted-foreground">{t("Total Stock courant", "إجمالي قيمة المخزون")} ({rows.length} {t("produit(s)", "منتج")})</span>
              <span className="text-xl font-bold tabular-nums">{fmtNum(total)} {currency}</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SupplierDebtsModal({ open, onClose, rows, loading, error, currency, t }: {
  open: boolean; onClose: () => void; rows: SupplierRow[]; loading: boolean; error: string | null; currency: string; t: TFn;
}) {
  const total = rows.reduce((s, r) => s + Number(r.balance ?? 0), 0);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Truck className="h-5 w-5 text-primary" />
            {t("Détail des Dettes fournisseurs", "تفاصيل ديون الموردين")}
          </DialogTitle>
        </DialogHeader>
        {loading && <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {!loading && error && <div className="flex items-center gap-2 text-destructive py-12 justify-center"><AlertCircle className="h-5 w-5" /><span className="text-sm">{error}</span></div>}
        {!loading && !error && rows.length === 0 && <p className="text-center text-muted-foreground text-sm py-16 px-6">{t("Aucun fournisseur avec un solde impayé.", "لا يوجد مورد لديه رصيد مستحق.")}</p>}
        {!loading && !error && rows.length > 0 && (
          <>
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10"><tr className="border-b">
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground text-xs uppercase">{t("Fournisseur", "المورد")}</th>
                  <th className="text-right py-2.5 px-4 font-semibold text-muted-foreground text-xs uppercase">{t("Solde dû", "المبلغ المستحق")}</th>
                </tr></thead>
                <tbody>{rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                    <td className="py-2.5 px-4 font-medium">{row.name}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold">{fmtNum(row.balance)} {currency}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="border-t px-6 py-4 flex items-center justify-between shrink-0 bg-muted/20">
              <span className="text-sm font-semibold text-muted-foreground">{t("Total", "الإجمالي")} ({rows.length} {t("fournisseur(s)", "مورد")})</span>
              <span className="text-xl font-bold tabular-nums">{fmtNum(total)} {currency}</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Général tab ──────────────────────────────────────────────────
function GeneralTab({ t, currency, lang, storeId }: { t: TFn; currency: string; lang: string; storeId?: string }) {
  const { data, loading: isLoading, error: genError } = useFetch<{ stockValue: number }>(buildPath("/api/erp/dashboard/general", storeId));
  const [stockDetailOpen, setStockDetailOpen] = useState(false);
  const [clientReceivablesOpen, setClientReceivablesOpen] = useState(false);
  const [supplierDebtsOpen, setSupplierDebtsOpen] = useState(false);

  const { rows: clientRows, loading: clientLoading, error: clientError } = useFetchList<ClientRow>(buildPath("/api/erp/dashboard/client-receivables", storeId));
  const { rows: supplierRows, loading: supplierLoading, error: supplierError } = useFetchList<SupplierRow>(buildPath("/api/erp/dashboard/supplier-debts", storeId));
  const { data: caissesData, loading: caissesLoading } = useFetch<CaissesData>(buildPath("/api/erp/dashboard/caisses", storeId));

  const clientTotal = clientRows.reduce((s, r) => s + Number(r.balance ?? 0), 0);
  const supplierTotal = supplierRows.reduce((s, r) => s + Number(r.balance ?? 0), 0);

  if (isLoading) return <LoadingGrid count={4} />;
  if (genError || !data) return <ErrorState t={t} />;

  const stockValue     = Number(data.stockValue ?? 0);
  const caissesTotal   = Number(caissesData?.total ?? 0);
  const supplierDebtsAbs = Math.abs(supplierTotal);
  const totalActifs    = stockValue + caissesTotal + clientTotal - supplierDebtsAbs;
  const actifLoading   = caissesLoading || clientLoading || supplierLoading;

  return (
    <>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <KpiCard icon={Package} labelFr="Stock courant" labelAr="قيمة المخزون" value={fmtNum(data.stockValue, currency)} t={t} onClick={() => setStockDetailOpen(true)} />
          <KpiCard icon={Wallet} labelFr="Trésorerie totale" labelAr="إجمالي الصناديق" value={caissesLoading ? "…" : fmtNum(caissesData?.total, currency)} t={t} />
          <KpiCard icon={Users} labelFr="Créances clients" labelAr="ذمم العملاء" value={clientLoading ? "…" : clientError ? "—" : fmtNum(clientTotal, currency)} t={t} onClick={() => setClientReceivablesOpen(true)} />
          <KpiCard icon={Truck} labelFr="Dettes fournisseurs" labelAr="ديون الموردين" value={supplierLoading ? "…" : supplierError ? "—" : fmtNum(supplierTotal, currency)} t={t} onClick={() => setSupplierDebtsOpen(true)} />
        </div>

        {/* ─── Total des actifs ──────────────────────────────────── */}
        <div className="rounded-xl border-2 border-primary/25 bg-gradient-to-br from-primary/5 via-background to-primary/10 p-5 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary/60 mb-0.5">
                {t("Total des actifs", "إجمالي الأصول")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Stock + Trésorerie + Créances clients − Dettes fournisseurs",
                  "المخزون + الصناديق + ذمم العملاء − ديون الموردين"
                )}
              </p>
            </div>
            {actifLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <div className="tabular-nums">
                <span className="text-3xl font-black text-primary">{fmtNum(totalActifs)}</span>
                <span className="text-lg font-semibold text-primary/70 ml-1.5">{currency}</span>
              </div>
            )}
          </div>
          {!actifLoading && (
            <div className="mt-4 pt-3 border-t border-primary/15 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {([
                [t("Stock", "المخزون"),            `${fmtNum(stockValue)} ${currency}`,     "text-foreground"],
                [t("Trésorerie", "الصناديق"),       `${fmtNum(caissesTotal)} ${currency}`,  "text-foreground"],
                [t("Créances clients", "ذمم العملاء"),    `+${fmtNum(clientTotal)} ${currency}`, "text-emerald-700 dark:text-emerald-400"],
                [t("Dettes fournisseurs", "ديون الموردين"), `−${fmtNum(supplierDebtsAbs)} ${currency}`, "text-destructive"],
              ] as [string, string, string][]).map(([label, value, cls]) => (
                <div key={label}>
                  <p className="text-muted-foreground mb-0.5">{label}</p>
                  <p className={`font-semibold tabular-nums ${cls}`}>{value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <StockDetailModal open={stockDetailOpen} onClose={() => setStockDetailOpen(false)} currency={currency} t={t} lang={lang} storeId={storeId} />
      <ClientReceivablesModal open={clientReceivablesOpen} onClose={() => setClientReceivablesOpen(false)} rows={clientRows} loading={clientLoading} error={clientError} currency={currency} t={t} />
      <SupplierDebtsModal open={supplierDebtsOpen} onClose={() => setSupplierDebtsOpen(false)} rows={supplierRows} loading={supplierLoading} error={supplierError} currency={currency} t={t} />
    </>
  );
}

// ─── Ventes tab ───────────────────────────────────────────────────
const VENTES_PAGE_SIZE = 20;

function VentesTab({ t, currency, storeId }: { t: TFn; currency: string; storeId?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [groupBy, setGroupBy] = React.useState<"jour" | "mois" | "annee">("jour");
  const [dateFrom, setDateFrom] = React.useState(defaultFrom);
  const [dateTo, setDateTo] = React.useState(today);
  const [rows, setRows] = React.useState<VenteRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const apiBase = ((import.meta.env.VITE_API_URL as string) ?? "").replace(/\/+$/, "");
    const token = localStorage.getItem("midanic_token");
    const params = new URLSearchParams({ groupBy, dateFrom, dateTo });
    if (storeId) params.set("storeId", storeId);
    fetch(`${apiBase}/api/erp/dashboard/ventes?${params}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then((r) => { if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`)); return r.json() as Promise<VenteRow[]>; })
      .then((data) => { setRows(data); setPage(1); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [groupBy, dateFrom, dateTo, storeId]);

  const totalPages = Math.max(1, Math.ceil(rows.length / VENTES_PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * VENTES_PAGE_SIZE, page * VENTES_PAGE_SIZE);
  const totals = rows.reduce(
    (acc, r) => ({ montant: acc.montant + Number(r.montant), reduction: acc.reduction + Number(r.reduction), retours: acc.retours + Number(r.retours), charges: acc.charges + Number(r.charges), benefice: acc.benefice + Number(r.benefice) }),
    { montant: 0, reduction: 0, retours: 0, charges: 0, benefice: 0 }
  );
  const startLine = rows.length === 0 ? 0 : (page - 1) * VENTES_PAGE_SIZE + 1;
  const endLine = Math.min(page * VENTES_PAGE_SIZE, rows.length);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t("Période", "الفترة")}</label>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as "jour" | "mois" | "annee")}
            className="w-full h-10 border rounded-md px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60"
          >
            <option value="jour">{t("Par jour", "يومياً")}</option>
            <option value="mois">{t("Par mois", "شهرياً")}</option>
            <option value="annee">{t("Par année", "سنوياً")}</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("Début", "البداية")}</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full h-10 border rounded-md px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("Fin", "النهاية")}</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full h-10 border rounded-md px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60"
            />
          </div>
        </div>
      </div>

      {/* Section title */}
      <h2 className="font-bold text-base border-b pb-2">{t("Ventes", "المبيعات")}</h2>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <ErrorState t={t} />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="py-2.5 px-4 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Date", "التاريخ")}</th>
                  <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Montant", "المبلغ")}</th>
                  <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Réduction", "التخفيض")}</th>
                  <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Retours", "المرتجعات")}</th>
                  <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Charges", "المصاريف")}</th>
                  <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Bénéfice net", "الربح الصافي")}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground italic text-sm">
                      {t("Aucune vente sur cette période", "لا توجد مبيعات في هذه الفترة")}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="py-2.5 px-4 font-medium tabular-nums">{row.date}</td>
                      <td className="py-2.5 px-4 text-right font-bold tabular-nums">{fmtNum(row.montant)}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums">{fmtNum(row.reduction)}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-amber-700">{fmtNum(row.retours)}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-amber-700">{fmtNum(row.charges)}</td>
                      <td className={`py-2.5 px-4 text-right font-semibold tabular-nums ${Number(row.benefice) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmtNum(row.benefice)}</td>
                    </tr>
                  ))
                )}
                {rows.length > 0 && (
                  <tr className="bg-rose-50 border-t-2 border-rose-200">
                    <td className="py-2.5 px-4 font-bold text-xs uppercase tracking-wide text-rose-800">TOTAL</td>
                    <td className="py-2.5 px-4 text-right font-bold tabular-nums text-rose-800">{fmtNum(totals.montant)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-rose-800">{fmtNum(totals.reduction)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-rose-800">{fmtNum(totals.retours)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-rose-800">{fmtNum(totals.charges)}</td>
                    <td className="py-2.5 px-4 text-right font-bold tabular-nums text-rose-800">{fmtNum(totals.benefice)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination info */}
      {rows.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>
            {t(
              `Lignes ${startLine} à ${endLine} (${rows.length} éléments)`,
              `سطر ${startLine} إلى ${endLine} (${rows.length} عنصر)`
            )}
          </span>
          <div className="flex items-center gap-1">
            <button
              className="h-7 w-7 flex items-center justify-center border rounded text-base hover:bg-muted/40 disabled:opacity-30 transition-colors"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label={t("Page précédente", "الصفحة السابقة")}
            >‹</button>
            <button
              className="h-7 w-7 flex items-center justify-center border rounded text-base hover:bg-muted/40 disabled:opacity-30 transition-colors"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label={t("Page suivante", "الصفحة التالية")}
            >›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bénéfice tab ─────────────────────────────────────────────────
const BENEFICE_PAGE_SIZE = 20;

function BeneficeTab({ t, currency, storeId }: { t: TFn; currency: string; storeId?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [groupBy, setGroupBy] = React.useState<"jour" | "mois" | "annee">("jour");
  const [dateFrom, setDateFrom] = React.useState(defaultFrom);
  const [dateTo, setDateTo] = React.useState(today);
  const [rows, setRows] = React.useState<VenteRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const apiBase = ((import.meta.env.VITE_API_URL as string) ?? "").replace(/\/+$/, "");
    const token = localStorage.getItem("midanic_token");
    const params = new URLSearchParams({ groupBy, dateFrom, dateTo });
    if (storeId) params.set("storeId", storeId);
    fetch(`${apiBase}/api/erp/dashboard/ventes?${params}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then((r) => { if (!r.ok) return Promise.reject(new Error(`HTTP ${r.status}`)); return r.json() as Promise<VenteRow[]>; })
      .then((data) => { setRows(data); setPage(1); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [groupBy, dateFrom, dateTo, storeId]);

  const totalPages = Math.max(1, Math.ceil(rows.length / BENEFICE_PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * BENEFICE_PAGE_SIZE, page * BENEFICE_PAGE_SIZE);
  const totals = rows.reduce(
    (acc, r) => ({ marge: acc.marge + Number(r.marge), retours: acc.retours + Number(r.retours), charges: acc.charges + Number(r.charges), benefice: acc.benefice + Number(r.benefice) }),
    { marge: 0, retours: 0, charges: 0, benefice: 0 }
  );
  const startLine = rows.length === 0 ? 0 : (page - 1) * BENEFICE_PAGE_SIZE + 1;
  const endLine = Math.min(page * BENEFICE_PAGE_SIZE, rows.length);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t("Période", "الفترة")}</label>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as "jour" | "mois" | "annee")}
            className="w-full h-10 border rounded-md px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60"
          >
            <option value="jour">{t("Par jour", "يومياً")}</option>
            <option value="mois">{t("Par mois", "شهرياً")}</option>
            <option value="annee">{t("Par année", "سنوياً")}</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("Début", "البداية")}</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="w-full h-10 border rounded-md px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">{t("Fin", "النهاية")}</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="w-full h-10 border rounded-md px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60" />
          </div>
        </div>
      </div>

      <h2 className="font-bold text-base border-b pb-2">{t("Bénéfice", "الأرباح")}</h2>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <ErrorState t={t} />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="py-2.5 px-4 text-left font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Date", "التاريخ")}</th>
                <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Marge brute", "الربح الإجمالي")}</th>
                <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Retours", "المرتجعات")}</th>
                <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Charges", "المصاريف")}</th>
                <th className="py-2.5 px-4 text-right font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t("Bénéfice net", "الربح الصافي")}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted-foreground italic text-sm">
                    {t("Aucune donnée sur cette période", "لا توجد بيانات في هذه الفترة")}
                  </td>
                </tr>
              ) : (
                pageRows.map((row, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="py-2.5 px-4 font-medium tabular-nums">{row.date}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{fmtNum(row.marge)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-amber-700">{fmtNum(row.retours)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-amber-700">{fmtNum(row.charges)}</td>
                    <td className={`py-2.5 px-4 text-right font-bold tabular-nums ${Number(row.benefice) < 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmtNum(row.benefice)}</td>
                  </tr>
                ))
              )}
              {rows.length > 0 && (
                <tr className="bg-rose-50 border-t-2 border-rose-200">
                  <td className="py-2.5 px-4 font-bold text-xs uppercase tracking-wide text-rose-800">TOTAL</td>
                  <td className="py-2.5 px-4 text-right font-semibold tabular-nums text-rose-800">{fmtNum(totals.marge)}</td>
                  <td className="py-2.5 px-4 text-right font-semibold tabular-nums text-rose-800">{fmtNum(totals.retours)}</td>
                  <td className="py-2.5 px-4 text-right font-semibold tabular-nums text-rose-800">{fmtNum(totals.charges)}</td>
                  <td className="py-2.5 px-4 text-right font-bold tabular-nums text-rose-800">{fmtNum(totals.benefice)}</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>
            {t(
              `Lignes ${startLine} à ${endLine} (${rows.length} éléments)`,
              `سطر ${startLine} إلى ${endLine} (${rows.length} عنصر)`
            )}
          </span>
          <div className="flex items-center gap-1">
            <button className="h-7 w-7 flex items-center justify-center border rounded text-base hover:bg-muted/40 disabled:opacity-30 transition-colors"
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              aria-label={t("Page précédente", "الصفحة السابقة")}>‹</button>
            <button className="h-7 w-7 flex items-center justify-center border rounded text-base hover:bg-muted/40 disabled:opacity-30 transition-colors"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              aria-label={t("Page suivante", "الصفحة التالية")}>›</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Clients tab ──────────────────────────────────────────────────
function ClientsTab({ t, currency, storeId }: { t: TFn; currency: string; storeId?: string }) {
  const { rows, loading, error } = useFetchList<ClientRow>(buildPath("/api/erp/dashboard/client-receivables", storeId));
  const total = rows.reduce((s, r) => s + Number(r.balance ?? 0), 0);

  if (loading) return <LoadingGrid count={2} />;
  if (error) return <ErrorState t={t} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard icon={Users} labelFr="Clients avec solde" labelAr="عملاء لديهم رصيد" value={String(rows.length)} t={t} />
        <KpiCard icon={TrendingUp} labelFr="Total Créances" labelAr="إجمالي الذمم" value={fmtNum(total, currency)} t={t} variant="negative" />
      </div>
      {rows.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">{t("Aucun client avec un solde impayé.", "لا يوجد عميل لديه رصيد مستحق.")}</p>
      ) : (
        <SimpleTable
          headers={[t("Client", "العميل"), t("Solde dû", "المبلغ المستحق")]}
          rows={rows.map((r) => [
            <span className="font-medium">{r.name}</span>,
            <span className="tabular-nums font-semibold text-destructive">{fmtNum(r.balance)} {currency}</span>,
          ])}
        />
      )}
    </div>
  );
}

// ─── Employés tab ─────────────────────────────────────────────────
function EmployesTab({ t, currency, storeId: _storeId }: { t: TFn; currency: string; storeId?: string }) {
  const { rows, loading, error } = useFetchList<Employee>("/api/erp/employees");

  if (loading) return <LoadingGrid count={2} />;
  if (error) return <ErrorState t={t} />;

  const active = rows.filter((e) => e.status === "active");
  const totalSalary = active.reduce((s, e) => s + Number(e.salary ?? 0), 0);

  const statusLabel: Record<string, string> = {
    active: t("Actif", "نشط"),
    inactive: t("Inactif", "غير نشط"),
    on_leave: t("En congé", "في إجازة"),
    terminated: t("Résilié", "منتهي"),
  };
  const statusColor: Record<string, string> = {
    active: "text-emerald-600",
    inactive: "text-muted-foreground",
    on_leave: "text-amber-600",
    terminated: "text-destructive",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard icon={UserCog} labelFr="Employés actifs" labelAr="الموظفون النشطون" value={String(active.length)} t={t} />
        <KpiCard icon={Wallet} labelFr="Masse salariale active" labelAr="إجمالي الرواتب النشطة" value={fmtNum(totalSalary, currency)} t={t} />
      </div>
      {rows.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">{t("Aucun employé.", "لا يوجد موظف.")}</p>
      ) : (
        <SimpleTable
          headers={[t("Nom", "الاسم"), t("Poste", "المنصب"), t("Salaire", "الراتب"), t("Statut", "الحالة")]}
          rows={rows.map((e) => [
            <span className="font-medium">{e.name}</span>,
            <span className="text-muted-foreground">{e.position}</span>,
            <span className="tabular-nums">{fmtNum(e.salary)} {currency}</span>,
            <span className={`font-medium text-xs ${statusColor[e.status] ?? ""}`}>{statusLabel[e.status] ?? e.status}</span>,
          ])}
        />
      )}
    </div>
  );
}

// ─── Stock tab ────────────────────────────────────────────────────
function StockTab({ t, currency, lang, storeId }: { t: TFn; currency: string; lang: string; storeId?: string }) {
  const { rows, loading, error } = useFetchList<StockRow>(buildPath("/api/erp/dashboard/stock-detail", storeId));
  const total = rows.reduce((s, r) => s + Number(r.valeur ?? 0), 0);

  if (loading) return <LoadingGrid count={2} />;
  if (error) return <ErrorState t={t} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard icon={Package} labelFr="Références en stock" labelAr="المراجع في المخزون" value={String(rows.length)} t={t} />
        <KpiCard icon={Wallet} labelFr="Valeur totale stock" labelAr="القيمة الإجمالية للمخزون" value={fmtNum(total, currency)} t={t} />
      </div>
      {rows.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">{t("Aucun produit en stock.", "لا يوجد منتج في المخزون.")}</p>
      ) : (
        <SimpleTable
          headers={[t("Produit", "المنتج"), t("Réf.", "المرجع"), t("Stock", "المخزون"), t("Coût unit.", "سعر التكلفة"), t("Valeur", "القيمة")]}
          rows={rows.map((r) => [
            <span className="font-medium">{lang === "ar" ? (r.nameAr || r.nameEn) : (r.nameEn || r.nameAr)}</span>,
            <span className="font-mono text-xs text-muted-foreground">{r.reference ?? "—"}</span>,
            <span className="tabular-nums">{r.stock}</span>,
            <span className="tabular-nums">{fmtNum(r.costPrice)} {currency}</span>,
            <span className="tabular-nums font-semibold">{fmtNum(r.valeur)} {currency}</span>,
          ])}
        />
      )}
    </div>
  );
}

// ─── Caisses tab ──────────────────────────────────────────────────
function CaissesTab({ t, currency, storeId }: { t: TFn; currency: string; storeId?: string }) {
  const { data, loading, error } = useFetch<CaissesData>(buildPath("/api/erp/dashboard/caisses", storeId));

  if (loading) return <LoadingGrid count={2} />;
  if (error || !data) return <ErrorState t={t} />;

  const mainCaisses = data.caisses.filter((c) => c.kind === "main");
  const staffCaisses = data.caisses.filter((c) => c.kind === "staff");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard icon={Wallet} labelFr="Trésorerie totale" labelAr="إجمالي الصناديق" value={fmtNum(data.total, currency)} t={t} variant="positive" />
        <KpiCard icon={UserCog} labelFr="Caisses staff actives" labelAr="صناديق الموظفين النشطة" value={String(staffCaisses.length)} t={t} />
      </div>

      {mainCaisses.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            {t("Caisse principale", "الصندوق الرئيسي")}
          </h3>
          <SimpleTable
            headers={[t("Type", "النوع"), t("Solde", "الرصيد")]}
            rows={mainCaisses.map((c) => [
              <span className="font-medium">{t("Caisse principale", "الصندوق الرئيسي")}</span>,
              <span className={`tabular-nums font-semibold ${Number(c.balance) >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                {fmtNum(c.balance)} {currency}
              </span>,
            ])}
          />
        </div>
      )}

      {staffCaisses.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
            {t("Caisses staff", "صناديق الموظفين")}
          </h3>
          <SimpleTable
            headers={[t("Employé", "الموظف"), t("Solde", "الرصيد")]}
            rows={staffCaisses.map((c) => [
              <span className="font-medium">{c.owner_name ?? t("(sans nom)", "(بدون اسم)")}</span>,
              <span className={`tabular-nums font-semibold ${Number(c.balance) >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                {fmtNum(c.balance)} {currency}
              </span>,
            ])}
          />
        </div>
      )}
    </div>
  );
}

// ─── Fournisseurs tab ─────────────────────────────────────────────
function FournisseursTab({ t, currency, storeId }: { t: TFn; currency: string; storeId?: string }) {
  const { rows, loading, error } = useFetchList<SupplierRow>(buildPath("/api/erp/dashboard/supplier-debts", storeId));
  const total = rows.reduce((s, r) => s + Number(r.balance ?? 0), 0);

  if (loading) return <LoadingGrid count={2} />;
  if (error) return <ErrorState t={t} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KpiCard icon={Truck} labelFr="Fournisseurs créditeurs" labelAr="موردون دائنون" value={String(rows.length)} t={t} />
        <KpiCard icon={Wallet} labelFr="Total Dettes" labelAr="إجمالي الديون" value={fmtNum(total, currency)} t={t} variant="negative" />
      </div>
      {rows.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-12">{t("Aucun fournisseur avec un solde impayé.", "لا يوجد مورد لديه رصيد مستحق.")}</p>
      ) : (
        <SimpleTable
          headers={[t("Fournisseur", "المورد"), t("Solde dû", "المبلغ المستحق")]}
          rows={rows.map((r) => [
            <span className="font-medium">{r.name}</span>,
            <span className="tabular-nums font-semibold text-destructive">{fmtNum(r.balance)} {currency}</span>,
          ])}
        />
      )}
    </div>
  );
}

// ─── Vente+ tab ───────────────────────────────────────────────────
const VP_PAGE_SIZES = [10, 25, 50];
type VPSortCol = keyof Pick<VentePlusRow, "designation" | "marque" | "famille" | "qte_vendue" | "pu" | "montant" | "benefice">;

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30 shrink-0" />;
  return dir === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />;
}

function VentePlusTab({ t, currency, storeId }: { t: TFn; currency: string; storeId?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today);
  const [allRows, setAllRows] = useState<VentePlusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({ designation: "", marque: "", famille: "", qte: "", pu: "", montant: "", benefice: "" });
  const [sort, setSort] = useState<{ col: VPSortCol; dir: "asc" | "desc" }>({ col: "montant", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<VentePlusRow | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    const apiBase = ((import.meta.env.VITE_API_URL as string) ?? "").replace(/\/+$/, "");
    const token = localStorage.getItem("midanic_token");
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (storeId) params.set("storeId", storeId);
    fetch(`${apiBase}/api/erp/dashboard/ventes-produits?${params}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<VentePlusRow[]>; })
      .then(data => { setAllRows(data); setPage(1); })
      .catch(e => setError(e instanceof Error ? e.message : "Erreur"))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, storeId]);

  const setFilter = (field: keyof typeof filters, v: string) => {
    setFilters(prev => ({ ...prev, [field]: v }));
    setPage(1);
  };

  const filtered = useMemo(() => allRows.filter(r => {
    if (filters.designation && !r.designation.toLowerCase().includes(filters.designation.toLowerCase())) return false;
    if (filters.marque && !r.marque.toLowerCase().includes(filters.marque.toLowerCase())) return false;
    if (filters.famille && !r.famille.toLowerCase().includes(filters.famille.toLowerCase())) return false;
    if (filters.qte && !String(r.qte_vendue).includes(filters.qte)) return false;
    if (filters.pu && !String(r.pu).includes(filters.pu)) return false;
    if (filters.montant && !String(r.montant).includes(filters.montant)) return false;
    if (filters.benefice && !String(r.benefice).includes(filters.benefice)) return false;
    return true;
  }), [allRows, filters]);

  const sorted = useMemo(() => {
    const isStr = sort.col === "designation" || sort.col === "marque" || sort.col === "famille";
    return [...filtered].sort((a, b) => {
      const av = isStr ? String(a[sort.col] ?? "") : Number(a[sort.col] ?? 0);
      const bv = isStr ? String(b[sort.col] ?? "") : Number(b[sort.col] ?? 0);
      if (av < bv) return sort.dir === "asc" ? -1 : 1;
      if (av > bv) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
  const gTot = sorted.reduce((a, r) => ({ montant: a.montant + Number(r.montant), benefice: a.benefice + Number(r.benefice), qte: a.qte + Number(r.qte_vendue) }), { montant: 0, benefice: 0, qte: 0 });
  const pTot = pageRows.reduce((a, r) => ({ montant: a.montant + Number(r.montant), benefice: a.benefice + Number(r.benefice) }), { montant: 0, benefice: 0 });

  const toggleSort = (col: VPSortCol) => setSort(p => ({ col, dir: p.col === col && p.dir === "desc" ? "asc" : "desc" }));

  const marge = selected && Number(selected.montant) > 0
    ? (Number(selected.benefice) / Number(selected.montant) * 100).toFixed(1) : "0";

  const cols: { key: VPSortCol; fr: string; ar: string; numeric?: boolean }[] = [
    { key: "designation", fr: "Désignation", ar: "المقال" },
    { key: "marque",      fr: "Marque",      ar: "الماركة" },
    { key: "famille",     fr: "Famille",     ar: "العائلة" },
    { key: "qte_vendue",  fr: "Qté",         ar: "الكمية",       numeric: true },
    { key: "pu",          fr: "PU",          ar: "س.الوحدة",     numeric: true },
    { key: "montant",     fr: "Montant",     ar: "المبلغ",       numeric: true },
    { key: "benefice",    fr: "Bénéfice",    ar: "الأرباح",      numeric: true },
  ];

  return (
    <div className="space-y-4">
      {/* Date filters */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t("Début", "البداية")}</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="w-full h-10 border rounded-md px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">{t("Fin", "النهاية")}</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="w-full h-10 border rounded-md px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60" />
        </div>
      </div>

      <h2 className="font-bold text-base border-b pb-2">{t("Articles", "المقالات")}</h2>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <ErrorState t={t} />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b bg-muted/40">
                  {cols.map(c => (
                    <th key={c.key} onClick={() => toggleSort(c.key)}
                      className={`py-2 px-3 cursor-pointer select-none hover:bg-muted/60 ${c.numeric ? "text-right" : "text-left"}`}>
                      <div className={`flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${c.numeric ? "justify-end" : ""}`}>
                        <span>{t(c.fr, c.ar)}</span>
                        <SortIcon active={sort.col === c.key} dir={sort.dir} />
                      </div>
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
                <tr className="border-b bg-slate-50/60">
                  {cols.map(c => (
                    <td key={c.key} className="py-1 px-3">
                      <input
                        value={filters[c.key === "qte_vendue" ? "qte" : c.key as keyof typeof filters] ?? ""}
                        onChange={e => setFilter(c.key === "qte_vendue" ? "qte" : c.key as keyof typeof filters, e.target.value)}
                        placeholder={t("Filtre...", "بحث...")}
                        className="w-full h-6 border-b border-dashed px-1 text-xs bg-transparent focus:outline-none focus:border-primary placeholder:text-muted-foreground/50"
                      />
                    </td>
                  ))}
                  <td />
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-muted-foreground italic text-sm">
                    {t("Aucune vente sur cette période", "لا توجد مبيعات في هذه الفترة")}
                  </td></tr>
                ) : pageRows.map((row, i) => (
                  <tr key={row.id ?? i} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="py-2 px-3 font-medium max-w-[180px] truncate" title={row.designation}>{row.designation}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground truncate">{row.marque || "—"}</td>
                    <td className="py-2 px-3 text-xs text-muted-foreground truncate">{row.famille || "—"}</td>
                    <td className="py-2 px-3 tabular-nums font-semibold text-right">{Number(row.qte_vendue).toLocaleString("fr-DZ")}</td>
                    <td className="py-2 px-3 tabular-nums text-right">{fmtNum(row.pu)}</td>
                    <td className="py-2 px-3 tabular-nums font-bold text-right">{fmtNum(row.montant)}</td>
                    <td className="py-2 px-3 tabular-nums font-semibold text-right text-emerald-700">{fmtNum(row.benefice)}</td>
                    <td className="py-2 px-3 text-center">
                      <button onClick={() => setSelected(row)} className="text-teal-600 hover:text-teal-800 transition-colors" aria-label="Détails">
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {sorted.length > 0 && (
                  <tr className="bg-rose-50 border-t-2 border-rose-200">
                    <td colSpan={3} className="py-2 px-3 text-xs">
                      <div className="font-bold text-rose-800 uppercase tracking-wide">TOTAL</div>
                      <div className="text-rose-600">{t("Total:", "الإجمالي:")} <span className="tabular-nums font-semibold">{fmtNum(gTot.montant)}</span></div>
                      <div className="text-rose-400">{t("Sum/page:", "ص:")} <span className="tabular-nums">{fmtNum(pTot.montant)}</span></div>
                    </td>
                    <td className="py-2 px-3 tabular-nums font-bold text-right text-rose-800">{gTot.qte.toLocaleString("fr-DZ")}</td>
                    <td />
                    <td className="py-2 px-3 tabular-nums font-bold text-right text-rose-800">{fmtNum(gTot.montant)}</td>
                    <td className="py-2 px-3 tabular-nums font-bold text-right text-rose-800">{fmtNum(gTot.benefice)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-muted-foreground">
          <span>
            {t(
              `Lignes ${sorted.length === 0 ? 0 : (page - 1) * pageSize + 1} à ${Math.min(page * pageSize, sorted.length)} (${sorted.length} éléments)`,
              `سطر ${sorted.length === 0 ? 0 : (page - 1) * pageSize + 1} إلى ${Math.min(page * pageSize, sorted.length)} (${sorted.length} عنصر)`
            )}
          </span>
          <div className="flex items-center gap-2">
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="h-7 border rounded px-2 text-xs bg-background">
              {VP_PAGE_SIZES.map(n => <option key={n} value={n}>{n} ▾</option>)}
            </select>
            <button className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted/40 disabled:opacity-30 text-base"
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>‹</button>
            <button className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted/40 disabled:opacity-30 text-base"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>›</button>
          </div>
        </div>
      )}

      {/* Product detail modal */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold leading-tight pr-6">{selected?.designation}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {([
                  [t("Marque", "الماركة"), selected.marque || "—"],
                  [t("Famille", "العائلة"), selected.famille || "—"],
                  [t("Référence", "المرجع"), selected.reference || "—"],
                  [t("Barcode", "الباركود"), selected.barcode || "—"],
                  [t("Stock actuel", "المخزون"), String(selected.stock ?? 0)],
                  [t("Prix catalogue", "السعر"), selected.price ? `${fmtNum(selected.price)} ${currency}` : "—"],
                ] as [string, string][]).map(([label, value]) => (
                  <React.Fragment key={label}>
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium tabular-nums">{value}</span>
                  </React.Fragment>
                ))}
              </div>
              <div className="border-t pt-3 grid grid-cols-2 gap-2">
                {[
                  { label: t("Qté vendue", "الكمية"), value: Number(selected.qte_vendue).toLocaleString("fr-DZ"), cls: "bg-muted/30" },
                  { label: t("Prix moyen", "متوسط السعر"), value: `${fmtNum(selected.pu)} ${currency}`, cls: "bg-muted/30" },
                  { label: t("Montant total", "الإجمالي"), value: `${fmtNum(selected.montant)} ${currency}`, cls: "bg-emerald-50 border border-emerald-100" },
                  { label: t("Bénéfice", "الأرباح"), value: `${fmtNum(selected.benefice)} ${currency}`, cls: "bg-emerald-50 border border-emerald-100" },
                ].map(({ label, value, cls }) => (
                  <div key={label} className={`rounded-md p-2.5 text-center ${cls}`}>
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-bold text-base tabular-nums">{value}</div>
                  </div>
                ))}
                <div className="col-span-2 bg-primary/5 rounded-md p-3 text-center border border-primary/10">
                  <div className="text-xs text-muted-foreground mb-1">{t("Marge bénéficiaire", "هامش الربح")}</div>
                  <div className="font-bold text-3xl tabular-nums text-primary">{marge}%</div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab config ───────────────────────────────────────────────────
const TABS = [
  { value: "general",      labelFr: "Général",      labelAr: "عام",        icon: LayoutDashboard },
  { value: "ventes",       labelFr: "Ventes",       labelAr: "المبيعات",   icon: ShoppingCart },
  { value: "vente-plus",   labelFr: "Vente+",       labelAr: "مبيعات+",    icon: TrendingUp },
  { value: "benefice",     labelFr: "Bénéfice",     labelAr: "الأرباح",    icon: TrendingUp },
  { value: "clients",      labelFr: "Clients",      labelAr: "العملاء",    icon: Users },
  { value: "employes",     labelFr: "Employés",     labelAr: "الموظفون",   icon: UserCog },
  { value: "stock",        labelFr: "Stock",        labelAr: "المخزون",    icon: Package },
  { value: "caisses",      labelFr: "Caisses",      labelAr: "الصناديق",   icon: Wallet },
  { value: "fournisseurs", labelFr: "Fournisseurs", labelAr: "الموردون",   icon: Truck },
] as const;

// ─── Dashboard page ───────────────────────────────────────────────
export default function Dashboard() {
  const { lang } = useLang();
  const t: TFn = (fr, ar) => (lang === "ar" ? ar : fr);
  const currency = lang === "ar" ? "دج" : "DA";

  const { token } = useAuth();
  const isAdmin = getTokenRole(token) === "admin";

  const [selectedStore, setSelectedStore] = useState<string>("all");
  const [stores, setStores] = useState<{ id: number; nameAr: string; nameEn: string }[]>([]);

  useEffect(() => {
    if (!isAdmin) return;
    const apiBase = ((import.meta.env.VITE_API_URL as string) ?? "").replace(/\/+$/, "");
    fetch(`${apiBase}/api/erp/stores/all`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then(r => r.ok ? r.json() as Promise<{ id: number; nameAr: string; nameEn: string }[]> : Promise.resolve([]))
      .then(setStores)
      .catch(() => {});
  }, [isAdmin, token]);

  const storeIdParam = selectedStore === "all" ? undefined : selectedStore;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-foreground">
          {t("Tableau de bord", "لوحة التحكم")}
        </h1>
        {isAdmin && stores.length > 0 && (
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <select
              value={selectedStore}
              onChange={e => setSelectedStore(e.target.value)}
              className="h-9 border rounded-md px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/60 min-w-[180px]"
            >
              <option value="all">{t("Tous les magasins", "جميع المحلات")}</option>
              {stores.map(s => (
                <option key={s.id} value={String(s.id)}>
                  {lang === "ar" ? s.nameAr : s.nameEn}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <Tabs defaultValue="general" className="flex flex-col flex-1 min-h-0">
        <div className="shrink-0 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-0.5">
          <TabsList className="inline-flex w-max min-w-full h-10 rounded-lg bg-muted p-1 gap-0.5">
            {TABS.map(({ value, labelFr, labelAr, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-sm font-medium rounded-md"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{t(labelFr, labelAr)}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="general" className="flex-1 mt-4 outline-none ring-0 focus-visible:ring-0">
          <GeneralTab t={t} currency={currency} lang={lang} storeId={storeIdParam} />
        </TabsContent>
        <TabsContent value="ventes" className="flex-1 mt-4 outline-none ring-0 focus-visible:ring-0">
          <VentesTab t={t} currency={currency} storeId={storeIdParam} />
        </TabsContent>
        <TabsContent value="vente-plus" className="flex-1 mt-4 outline-none ring-0 focus-visible:ring-0">
          <VentePlusTab t={t} currency={currency} storeId={storeIdParam} />
        </TabsContent>
        <TabsContent value="benefice" className="flex-1 mt-4 outline-none ring-0 focus-visible:ring-0">
          <BeneficeTab t={t} currency={currency} storeId={storeIdParam} />
        </TabsContent>
        <TabsContent value="clients" className="flex-1 mt-4 outline-none ring-0 focus-visible:ring-0">
          <ClientsTab t={t} currency={currency} storeId={storeIdParam} />
        </TabsContent>
        <TabsContent value="employes" className="flex-1 mt-4 outline-none ring-0 focus-visible:ring-0">
          <EmployesTab t={t} currency={currency} storeId={storeIdParam} />
        </TabsContent>
        <TabsContent value="stock" className="flex-1 mt-4 outline-none ring-0 focus-visible:ring-0">
          <StockTab t={t} currency={currency} lang={lang} storeId={storeIdParam} />
        </TabsContent>
        <TabsContent value="caisses" className="flex-1 mt-4 outline-none ring-0 focus-visible:ring-0">
          <CaissesTab t={t} currency={currency} storeId={storeIdParam} />
        </TabsContent>
        <TabsContent value="fournisseurs" className="flex-1 mt-4 outline-none ring-0 focus-visible:ring-0">
          <FournisseursTab t={t} currency={currency} storeId={storeIdParam} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
