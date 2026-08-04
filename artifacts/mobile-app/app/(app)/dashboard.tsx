/**
 * Dashboard mobile — مطابق للـ ERP
 * 9 tabs: Général · Ventes · Bénéfice · Vente+ · Clients · Employés · Stock · Caisses · Fournisseurs
 */
import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, FlatList, Pressable,
  Modal, ActivityIndicator, TextInput, RefreshControl,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { colors } from "@/lib/colors";
import { erpFetch } from "@/hooks/use-smart-purchase";

// ─── Number formatter ─────────────────────────────────────────────────────────
function fmtNum(v: string | number | null | undefined, currency = ""): string {
  const n = Number(v ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const formatted = safe.toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${formatted} ${currency}` : formatted;
}

function todayStr(): string { return new Date().toISOString().slice(0, 10); }
function daysAgoStr(d: number): string { return new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10); }
function monthStartStr(): string {
  const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}
function yearStartStr(): string { return `${new Date().getFullYear()}-01-01`; }

// ─── Types ────────────────────────────────────────────────────────────────────
type StockRow    = { id: number; nameEn: string; nameAr: string; reference: string | null; stock: number; costPrice: string; valeur: string };
type ClientRow   = { id: number; name: string; balance: string };
type SupplierRow = { id: number; name: string; balance: string };
type CaisseRow   = { id: number; kind: string; balance: string; owner_name: string | null };
type CaissesData = { total: string; caisses: CaisseRow[] };
type VenteRow    = { date: string; montant: string; reduction: string; marge: string; retours: string; charges: string; benefice: string };
type VentePlusRow = {
  id: number; row_type: string; designation: string; marque: string; famille: string;
  reference: string | null; stock: number; price: string | null; cost_price_product: string | null;
  qte_vendue: string; pu: string; montant: string; benefice: string;
};
type Employee = { id: number; name: string; position: string; salary: string; status: string };

// ─── Shared fetch hook ────────────────────────────────────────────────────────
function useDash<T>(key: string[], url: string, enabled = true) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => erpFetch(url) as Promise<T>,
    enabled,
    staleTime: 30_000,
  });
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
type KpiVariant = "default" | "positive" | "negative";
function KpiCard({
  icon, labelFr, labelAr, value, t, onPress, variant = "default", warning,
}: {
  icon: string; labelFr: string; labelAr: string; value: string;
  t: (fr: string, ar: string) => string; onPress?: () => void;
  variant?: KpiVariant; warning?: number;
}) {
  const valueColor = variant === "positive" ? colors.success : variant === "negative" ? colors.danger : colors.text;
  return (
    <Pressable style={kpi.card} onPress={onPress} disabled={!onPress}>
      <View style={kpi.header}>
        <Text style={kpi.label}>{t(labelFr, labelAr)}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {warning != null && warning > 0 ? (
            <View style={kpi.warningBadge}><Text style={kpi.warningTxt}>{warning}</Text></View>
          ) : null}
          <Feather name={icon as any} size={16} color={colors.textMuted} />
        </View>
      </View>
      <Text style={[kpi.value, { color: valueColor }]}>{value}</Text>
      {onPress ? <Text style={kpi.hint}>{t("Tap pour le détail", "اضغط للتفاصيل")}</Text> : null}
    </Pressable>
  );
}
const kpi = StyleSheet.create({
  card: { flex: 1, minWidth: "45%", backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 4 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 12, color: colors.textMuted, fontWeight: "600", flex: 1, marginRight: 4 },
  value: { fontSize: 18, fontWeight: "800" },
  hint: { fontSize: 10, color: colors.textMuted, marginTop: 2 },
  warningBadge: { backgroundColor: "#fed7aa", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  warningTxt: { fontSize: 10, fontWeight: "700", color: "#c2410c" },
});

// ─── KPI row (2 per row) ──────────────────────────────────────────────────────
function KpiRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>{children}</View>;
}

// ─── Section title ────────────────────────────────────────────────────────────
function STitle({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>{children}</Text>;
}

// ─── Simple table ─────────────────────────────────────────────────────────────
function MTable({ headers, rows, emptyText }: {
  headers: string[]; rows: (string | React.ReactNode)[][]; emptyText?: string;
}) {
  return (
    <View style={mt.wrap}>
      <View style={mt.head}>
        {headers.map((h, i) => <Text key={i} style={[mt.th, i > 0 && mt.right]}>{h}</Text>)}
      </View>
      {rows.length === 0 ? (
        <Text style={mt.empty}>{emptyText ?? "—"}</Text>
      ) : rows.map((row, i) => (
        <View key={i} style={[mt.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
          {row.map((cell, j) => (
            <View key={j} style={[mt.cell, j > 0 && mt.rightCell]}>
              {typeof cell === "string" ? <Text style={mt.td}>{cell}</Text> : cell}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
const mt = StyleSheet.create({
  wrap: { borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  head: { flexDirection: "row", backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  th: { flex: 1, fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  right: { textAlign: "right" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  cell: { flex: 1, justifyContent: "center" },
  rightCell: { alignItems: "flex-end" },
  td: { fontSize: 13, color: colors.text },
  empty: { textAlign: "center", color: colors.textMuted, fontSize: 13, paddingVertical: 20 },
});

// ─── Total row for tables ─────────────────────────────────────────────────────
function TotalRow({ cells }: { cells: string[] }) {
  return (
    <View style={{ flexDirection: "row", backgroundColor: "#fff1f2", borderTopWidth: 2, borderTopColor: "#fecdd3", paddingHorizontal: 12, paddingVertical: 10 }}>
      {cells.map((c, i) => (
        <Text key={i} style={[{ flex: 1, fontSize: 12, fontWeight: "800", color: "#9f1239" }, i > 0 && { textAlign: "right" }]}>{c}</Text>
      ))}
    </View>
  );
}

// ─── Date preset bar ──────────────────────────────────────────────────────────
type DatePreset = "jour" | "30j" | "mois" | "annee" | "custom";
function DatePresetBar({
  preset, onPreset, dateFrom, dateTo, onFrom, onTo, t,
}: {
  preset: DatePreset; onPreset: (p: DatePreset) => void;
  dateFrom: string; dateTo: string;
  onFrom: (v: string) => void; onTo: (v: string) => void;
  t: (fr: string, ar: string) => string;
}) {
  const options: { key: DatePreset; fr: string; ar: string }[] = [
    { key: "jour",   fr: "Auj.", ar: "اليوم" },
    { key: "30j",    fr: "30j",  ar: "30 يوماً" },
    { key: "mois",   fr: "Mois", ar: "الشهر" },
    { key: "annee",  fr: "Année",ar: "السنة" },
    { key: "custom", fr: "...",  ar: "..." },
  ];
  return (
    <View style={{ gap: 8 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {options.map((o) => (
          <Pressable key={o.key} onPress={() => onPreset(o.key)}
            style={[dp.pill, preset === o.key && dp.pillOn]}>
            <Text style={[dp.txt, preset === o.key && dp.txtOn]}>{t(o.fr, o.ar)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {preset === "custom" && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={dp.label}>{t("Début", "البداية")}</Text>
            <TextInput style={dp.input} value={dateFrom} onChangeText={onFrom} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={dp.label}>{t("Fin", "النهاية")}</Text>
            <TextInput style={dp.input} value={dateTo} onChangeText={onTo} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textMuted} />
          </View>
        </View>
      )}
    </View>
  );
}
const dp = StyleSheet.create({
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  txt: { fontSize: 13, color: colors.text, fontWeight: "500" },
  txtOn: { color: "#fff" },
  label: { fontSize: 11, color: colors.textMuted, marginBottom: 4 },
  input: { height: 38, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, fontSize: 13, color: colors.text, backgroundColor: colors.surface },
});

// ─── Source filter bar ────────────────────────────────────────────────────────
type Source = "all" | "pos" | "online" | "bon";
function SourceBar({ source, onSource, t }: {
  source: Source; onSource: (s: Source) => void; t: (fr: string, ar: string) => string;
}) {
  const opts: { key: Source; fr: string; ar: string }[] = [
    { key: "all",    fr: "Tout",     ar: "الكل" },
    { key: "pos",    fr: "Rapide",   ar: "سريع" },
    { key: "online", fr: "En ligne", ar: "إلكتروني" },
    { key: "bon",    fr: "Bon",      ar: "وصل" },
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {opts.map((o) => (
        <Pressable key={o.key} onPress={() => onSource(o.key)}
          style={[dp.pill, source === o.key && dp.pillOn]}>
          <Text style={[dp.txt, source === o.key && dp.txtOn]}>{t(o.fr, o.ar)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ─── Detail sheet (slide-up modal) ───────────────────────────────────────────
function DetailSheet({ visible, onClose, title, children, loading }: {
  visible: boolean; onClose: () => void; title: string;
  children?: React.ReactNode; loading?: boolean;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={ds.overlay}>
        <View style={ds.sheet}>
          <View style={ds.header}>
            <Text style={ds.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}><Feather name="x" size={22} color={colors.text} /></Pressable>
          </View>
          {loading ? (
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
              {children}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
const ds = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 16, fontWeight: "700", color: colors.text, flex: 1 },
});

// ─── Loading / Error ──────────────────────────────────────────────────────────
function TabLoading() {
  return <ActivityIndicator color={colors.primary} style={{ marginVertical: 40 }} />;
}
function TabError({ t }: { t: (fr: string, ar: string) => string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
      <Feather name="alert-circle" size={28} color={colors.danger} />
      <Text style={{ color: colors.danger, fontSize: 14 }}>{t("Erreur de chargement", "خطأ في التحميل")}</Text>
    </View>
  );
}

// ─── GÉNÉRAL tab ──────────────────────────────────────────────────────────────
function GeneralTab({ t, currency, lang }: { t: (fr: string, ar: string) => string; currency: string; lang: string }) {
  const [stockOpen,    setStockOpen]    = useState(false);
  const [clientOpen,   setClientOpen]   = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);

  const genQ  = useDash<{ stockValue: number; productsWithoutCost: number }>(["dash-general"],  "/api/erp/dashboard/general");
  const cliQ  = useDash<ClientRow[]>(   ["dash-clients"],   "/api/erp/dashboard/client-receivables");
  const supQ  = useDash<SupplierRow[]>( ["dash-suppliers"], "/api/erp/dashboard/supplier-debts");
  const caiQ  = useDash<CaissesData>(   ["dash-caisses"],   "/api/erp/dashboard/caisses");

  if (genQ.isLoading) return <TabLoading />;
  if (genQ.isError || !genQ.data) return <TabError t={t} />;

  const stockValue  = Number(genQ.data.stockValue ?? 0);
  const caisseTotal = Number(caiQ.data?.total ?? 0);
  const clientTotal = (cliQ.data ?? []).reduce((s, r) => s + Number(r.balance ?? 0), 0);
  const supplierAbs = Math.abs((supQ.data ?? []).reduce((s, r) => s + Number(r.balance ?? 0), 0));
  const totalActifs = stockValue + caisseTotal + clientTotal - supplierAbs;
  const actifLoading = caiQ.isLoading || cliQ.isLoading || supQ.isLoading;

  return (
    <View style={{ gap: 14 }}>
      {/* 4 KPI cards */}
      <KpiRow>
        <KpiCard icon="package" labelFr="Stock courant" labelAr="قيمة المخزون"
          value={fmtNum(genQ.data.stockValue, currency)} t={t}
          onPress={() => setStockOpen(true)}
          warning={genQ.data.productsWithoutCost} />
        <KpiCard icon="credit-card" labelFr="Trésorerie totale" labelAr="إجمالي الصناديق"
          value={caiQ.isLoading ? "…" : fmtNum(caiQ.data?.total, currency)} t={t} variant="positive" />
      </KpiRow>
      <KpiRow>
        <KpiCard icon="users" labelFr="Créances clients" labelAr="ذمم العملاء"
          value={cliQ.isLoading ? "…" : fmtNum(clientTotal, currency)} t={t}
          onPress={() => setClientOpen(true)} />
        <KpiCard icon="truck" labelFr="Dettes fournisseurs" labelAr="ديون الموردين"
          value={supQ.isLoading ? "…" : fmtNum(supplierAbs, currency)} t={t} variant="negative"
          onPress={() => setSupplierOpen(true)} />
      </KpiRow>

      {/* Total des actifs */}
      <View style={gen.actifCard}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
            <Text style={gen.actifTitle}>{t("Total des actifs", "إجمالي الأصول")}</Text>
            <Text style={gen.actifSub}>{t("Stock + Trésorerie + Créances − Dettes", "مخزون + صناديق + ذمم − ديون")}</Text>
          </View>
          {actifLoading ? <ActivityIndicator color={colors.primary} size="small" /> : (
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
              <Text style={gen.actifValue}>{fmtNum(totalActifs)}</Text>
              <Text style={gen.actifCcy}>{currency}</Text>
            </View>
          )}
        </View>
        {!actifLoading && (
          <View style={gen.actifBreakdown}>
            {([
              [t("Stock", "المخزون"),            `${fmtNum(stockValue)} ${currency}`,      colors.text],
              [t("Trésorerie", "الصناديق"),       `${fmtNum(caisseTotal)} ${currency}`,     colors.text],
              [t("Créances clients", "ذمم العملاء"), `+${fmtNum(clientTotal)} ${currency}`, colors.success],
              [t("Dettes fournisseurs", "ديون الموردين"), `−${fmtNum(supplierAbs)} ${currency}`, colors.danger],
            ] as [string, string, string][]).map(([label, val, color]) => (
              <View key={label} style={{ width: "48%" }}>
                <Text style={gen.bdLabel}>{label}</Text>
                <Text style={[gen.bdValue, { color }]}>{val}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Stock detail sheet */}
      <StockDetailSheet open={stockOpen} onClose={() => setStockOpen(false)} currency={currency} t={t} lang={lang} />

      {/* Client receivables sheet */}
      <DetailSheet visible={clientOpen} onClose={() => setClientOpen(false)}
        title={t("Créances clients", "ذمم العملاء")} loading={cliQ.isLoading}>
        {(cliQ.data ?? []).length === 0 ? (
          <Text style={{ color: colors.textMuted, textAlign: "center", marginTop: 20 }}>
            {t("Aucun client avec un solde.", "لا يوجد عميل لديه رصيد.")}
          </Text>
        ) : (
          <View style={{ gap: 10 }}>
            {(cliQ.data ?? []).map((r) => (
              <View key={r.id} style={gen.detailRow}>
                <Text style={gen.detailName}>{r.name}</Text>
                <Text style={[gen.detailAmt, { color: colors.danger }]}>{fmtNum(r.balance)} {currency}</Text>
              </View>
            ))}
            <View style={gen.totalRow}>
              <Text style={gen.totalLabel}>{t("Total", "الإجمالي")} ({(cliQ.data ?? []).length})</Text>
              <Text style={gen.totalAmt}>{fmtNum(clientTotal)} {currency}</Text>
            </View>
          </View>
        )}
      </DetailSheet>

      {/* Supplier debts sheet */}
      <DetailSheet visible={supplierOpen} onClose={() => setSupplierOpen(false)}
        title={t("Dettes fournisseurs", "ديون الموردين")} loading={supQ.isLoading}>
        {(supQ.data ?? []).length === 0 ? (
          <Text style={{ color: colors.textMuted, textAlign: "center", marginTop: 20 }}>
            {t("Aucun fournisseur avec un solde.", "لا يوجد مورد لديه رصيد.")}
          </Text>
        ) : (
          <View style={{ gap: 10 }}>
            {(supQ.data ?? []).map((r) => (
              <View key={r.id} style={gen.detailRow}>
                <Text style={gen.detailName}>{r.name}</Text>
                <Text style={[gen.detailAmt, { color: colors.danger }]}>{fmtNum(r.balance)} {currency}</Text>
              </View>
            ))}
            <View style={gen.totalRow}>
              <Text style={gen.totalLabel}>{t("Total", "الإجمالي")} ({(supQ.data ?? []).length})</Text>
              <Text style={gen.totalAmt}>{fmtNum(supplierAbs)} {currency}</Text>
            </View>
          </View>
        )}
      </DetailSheet>
    </View>
  );
}

function StockDetailSheet({ open, onClose, currency, t, lang }: {
  open: boolean; onClose: () => void; currency: string;
  t: (fr: string, ar: string) => string; lang: string;
}) {
  const q = useDash<StockRow[]>(["dash-stock-detail"], "/api/erp/dashboard/stock-detail", open);
  const total = (q.data ?? []).reduce((s, r) => s + Number(r.valeur ?? 0), 0);
  return (
    <DetailSheet visible={open} onClose={onClose}
      title={t("Détail du stock courant", "تفاصيل قيمة المخزون")} loading={q.isLoading}>
      <View style={{ gap: 6 }}>
        {(q.data ?? []).map((r) => (
          <View key={r.id} style={[gen.detailRow, { flexDirection: "column", gap: 2 }]}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={gen.detailName} numberOfLines={1}>
                {lang === "ar" ? (r.nameAr || r.nameEn) : (r.nameEn || r.nameAr)}
              </Text>
              <Text style={[gen.detailAmt, { color: colors.primary }]}>{fmtNum(r.valeur)} {currency}</Text>
            </View>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>
              {t("Stock", "المخزون")}: {r.stock} · {t("Coût", "التكلفة")}: {fmtNum(r.costPrice)} {currency}
              {r.reference ? ` · Réf: ${r.reference}` : ""}
            </Text>
          </View>
        ))}
        {(q.data ?? []).length > 0 && (
          <View style={gen.totalRow}>
            <Text style={gen.totalLabel}>{t("Total stock", "إجمالي المخزون")} ({(q.data ?? []).length})</Text>
            <Text style={gen.totalAmt}>{fmtNum(total)} {currency}</Text>
          </View>
        )}
      </View>
    </DetailSheet>
  );
}

const gen = StyleSheet.create({
  actifCard: { backgroundColor: colors.primary + "10", borderRadius: 14, borderWidth: 2, borderColor: colors.primary + "40", padding: 16, gap: 12 },
  actifTitle: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, color: colors.primary + "99" },
  actifSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  actifValue: { fontSize: 26, fontWeight: "900", color: colors.primary },
  actifCcy: { fontSize: 16, fontWeight: "700", color: colors.primary + "bb" },
  actifBreakdown: { flexDirection: "row", flexWrap: "wrap", gap: 10, borderTopWidth: 1, borderTopColor: colors.primary + "30", paddingTop: 10 },
  bdLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  bdValue: { fontSize: 13, fontWeight: "700" },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailName: { flex: 1, fontSize: 14, color: colors.text, marginRight: 8, fontWeight: "500" },
  detailAmt: { fontSize: 14, fontWeight: "700" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 12, marginTop: 4, borderTopWidth: 2, borderTopColor: colors.border },
  totalLabel: { fontSize: 13, fontWeight: "700", color: colors.textMuted },
  totalAmt: { fontSize: 16, fontWeight: "800", color: colors.text },
});

// ─── VENTES tab ───────────────────────────────────────────────────────────────
function VentesTab({ t, currency, canViewProfit }: { t: (fr: string, ar: string) => string; currency: string; canViewProfit: boolean }) {
  const [preset, setPreset]   = useState<DatePreset>("30j");
  const [dateFrom, setDateFrom] = useState(daysAgoStr(30));
  const [dateTo, setDateTo]   = useState(todayStr());
  const [groupBy, setGroupBy] = useState<"jour" | "mois" | "annee">("jour");
  const [source, setSource]   = useState<Source>("all");
  const [page, setPage]       = useState(1);
  const PAGE = 20;

  function applyPreset(p: DatePreset) {
    setPreset(p); setPage(1);
    if (p === "jour")   { setDateFrom(todayStr());      setDateTo(todayStr()); }
    else if (p === "30j")   { setDateFrom(daysAgoStr(30));  setDateTo(todayStr()); }
    else if (p === "mois")  { setDateFrom(monthStartStr()); setDateTo(todayStr()); }
    else if (p === "annee") { setDateFrom(yearStartStr());  setDateTo(todayStr()); }
  }

  const params = new URLSearchParams({ groupBy, dateFrom, dateTo });
  if (source !== "all") params.set("source", source);
  const qkey = ["dash-ventes", groupBy, dateFrom, dateTo, source];
  const { data: rows = [], isLoading, isError } = useDash<VenteRow[]>(qkey, `/api/erp/dashboard/ventes?${params}`);

  const totals = useMemo(() => rows.reduce(
    (a, r) => ({ montant: a.montant + Number(r.montant), reduction: a.reduction + Number(r.reduction), retours: a.retours + Number(r.retours), charges: a.charges + Number(r.charges), benefice: a.benefice + Number(r.benefice) }),
    { montant: 0, reduction: 0, retours: 0, charges: 0, benefice: 0 }
  ), [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);

  const groupOpts: { key: "jour" | "mois" | "annee"; fr: string; ar: string }[] = [
    { key: "jour",  fr: "Jour",  ar: "يومي" },
    { key: "mois",  fr: "Mois",  ar: "شهري" },
    { key: "annee", fr: "Année", ar: "سنوي" },
  ];

  return (
    <View style={{ gap: 12 }}>
      {/* Granularity */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {groupOpts.map((o) => (
          <Pressable key={o.key} onPress={() => { setGroupBy(o.key); setPage(1); }}
            style={[dp.pill, groupBy === o.key && dp.pillOn]}>
            <Text style={[dp.txt, groupBy === o.key && dp.txtOn]}>{t(o.fr, o.ar)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {/* Date range */}
      <DatePresetBar preset={preset} onPreset={applyPreset} dateFrom={dateFrom} dateTo={dateTo} onFrom={(v) => { setDateFrom(v); setPage(1); }} onTo={(v) => { setDateTo(v); setPage(1); }} t={t} />
      {/* Source */}
      <SourceBar source={source} onSource={(s) => { setSource(s); setPage(1); }} t={t} />

      <STitle>{t("Ventes", "المبيعات")}</STitle>

      {isLoading ? <TabLoading /> : isError ? <TabError t={t} /> : (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ minWidth: 380 }}>
              <View style={[mt.head, { paddingHorizontal: 8 }]}>
                {[t("Date", "التاريخ"), t("Montant", "المبلغ"), t("Réd.", "تخفيض"), t("Ret.", "مرتجع"), t("Ch.", "مصاريف"), ...(canViewProfit ? [t("Bén.", "الربح")] : [])].map((h, i) => (
                  <Text key={i} style={[{ flex: i === 0 ? 1.5 : 1, fontSize: 10, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" }, i > 0 && { textAlign: "right" }]}>{h}</Text>
                ))}
              </View>
              {pageRows.length === 0 ? (
                <Text style={mt.empty}>{t("Aucune vente sur cette période", "لا توجد مبيعات")}</Text>
              ) : pageRows.map((r, i) => (
                <View key={i} style={[mt.row, { paddingHorizontal: 8 }, i === pageRows.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={[{ flex: 1.5, fontSize: 12, color: colors.text, fontWeight: "600" }]}>{r.date}</Text>
                  <Text style={[{ flex: 1, fontSize: 12, textAlign: "right", fontWeight: "700", color: colors.text }]}>{fmtNum(r.montant)}</Text>
                  <Text style={[{ flex: 1, fontSize: 12, textAlign: "right", color: colors.textMuted }]}>{fmtNum(r.reduction)}</Text>
                  <Text style={[{ flex: 1, fontSize: 12, textAlign: "right", color: "#b45309" }]}>{fmtNum(r.retours)}</Text>
                  <Text style={[{ flex: 1, fontSize: 12, textAlign: "right", color: "#b45309" }]}>{fmtNum(r.charges)}</Text>
                  {canViewProfit && <Text style={[{ flex: 1, fontSize: 12, textAlign: "right", fontWeight: "700", color: Number(r.benefice) < 0 ? colors.danger : colors.success }]}>{fmtNum(r.benefice)}</Text>}
                </View>
              ))}
              {rows.length > 0 && (
                <View style={[mt.row, { backgroundColor: "#fff1f2", borderTopWidth: 2, borderTopColor: "#fecdd3", paddingHorizontal: 8 }]}>
                  <Text style={{ flex: 1.5, fontSize: 11, fontWeight: "800", color: "#9f1239" }}>TOTAL</Text>
                  <Text style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "800", color: "#9f1239" }}>{fmtNum(totals.montant)}</Text>
                  <Text style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "700", color: "#9f1239" }}>{fmtNum(totals.reduction)}</Text>
                  <Text style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "700", color: "#9f1239" }}>{fmtNum(totals.retours)}</Text>
                  <Text style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "700", color: "#9f1239" }}>{fmtNum(totals.charges)}</Text>
                  {canViewProfit && <Text style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "800", color: "#9f1239" }}>{fmtNum(totals.benefice)}</Text>}
                </View>
              )}
            </View>
          </ScrollView>
          {/* Pagination */}
          {totalPages > 1 && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8 }}>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>
                {t(`${Math.min((page-1)*PAGE+1,rows.length)}-${Math.min(page*PAGE,rows.length)} / ${rows.length}`, `${Math.min((page-1)*PAGE+1,rows.length)}-${Math.min(page*PAGE,rows.length)} / ${rows.length}`)}
              </Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Pressable onPress={() => setPage(p => Math.max(1, p-1))} disabled={page <= 1} style={[pg.btn, page <= 1 && { opacity: 0.3 }]}>
                  <Feather name="chevron-left" size={16} color={colors.text} />
                </Pressable>
                <Pressable onPress={() => setPage(p => Math.min(totalPages, p+1))} disabled={page >= totalPages} style={[pg.btn, page >= totalPages && { opacity: 0.3 }]}>
                  <Feather name="chevron-right" size={16} color={colors.text} />
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const pg = StyleSheet.create({
  btn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
});

// ─── BÉNÉFICE tab ─────────────────────────────────────────────────────────────
function BeneficeTab({ t, currency }: { t: (fr: string, ar: string) => string; currency: string }) {
  const [preset, setPreset]   = useState<DatePreset>("30j");
  const [dateFrom, setDateFrom] = useState(daysAgoStr(30));
  const [dateTo, setDateTo]   = useState(todayStr());
  const [groupBy, setGroupBy] = useState<"jour" | "mois" | "annee">("jour");
  const [source, setSource]   = useState<Source>("all");
  const [page, setPage]       = useState(1);
  const PAGE = 20;

  function applyPreset(p: DatePreset) {
    setPreset(p); setPage(1);
    if (p === "jour")   { setDateFrom(todayStr());      setDateTo(todayStr()); }
    else if (p === "30j")   { setDateFrom(daysAgoStr(30));  setDateTo(todayStr()); }
    else if (p === "mois")  { setDateFrom(monthStartStr()); setDateTo(todayStr()); }
    else if (p === "annee") { setDateFrom(yearStartStr());  setDateTo(todayStr()); }
  }

  const params = new URLSearchParams({ groupBy, dateFrom, dateTo });
  if (source !== "all") params.set("source", source);
  const qkey = ["dash-benefice", groupBy, dateFrom, dateTo, source];
  const { data: rows = [], isLoading, isError } = useDash<VenteRow[]>(qkey, `/api/erp/dashboard/ventes?${params}`);

  const totals = useMemo(() => rows.reduce(
    (a, r) => ({ marge: a.marge + Number(r.marge), retours: a.retours + Number(r.retours), charges: a.charges + Number(r.charges), benefice: a.benefice + Number(r.benefice) }),
    { marge: 0, retours: 0, charges: 0, benefice: 0 }
  ), [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);

  const groupOpts: { key: "jour" | "mois" | "annee"; fr: string; ar: string }[] = [
    { key: "jour",  fr: "Jour",  ar: "يومي" },
    { key: "mois",  fr: "Mois",  ar: "شهري" },
    { key: "annee", fr: "Année", ar: "سنوي" },
  ];

  return (
    <View style={{ gap: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {groupOpts.map((o) => (
          <Pressable key={o.key} onPress={() => { setGroupBy(o.key); setPage(1); }}
            style={[dp.pill, groupBy === o.key && dp.pillOn]}>
            <Text style={[dp.txt, groupBy === o.key && dp.txtOn]}>{t(o.fr, o.ar)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <DatePresetBar preset={preset} onPreset={applyPreset} dateFrom={dateFrom} dateTo={dateTo} onFrom={(v) => { setDateFrom(v); setPage(1); }} onTo={(v) => { setDateTo(v); setPage(1); }} t={t} />
      <SourceBar source={source} onSource={(s) => { setSource(s); setPage(1); }} t={t} />

      <STitle>{t("Bénéfice", "الأرباح")}</STitle>

      {isLoading ? <TabLoading /> : isError ? <TabError t={t} /> : (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ minWidth: 340 }}>
              <View style={[mt.head, { paddingHorizontal: 8 }]}>
                {[t("Date", "التاريخ"), t("Marge", "الهامش"), t("Ret.", "مرتجع"), t("Ch.", "مصاريف"), t("Bén. net", "الربح")].map((h, i) => (
                  <Text key={i} style={[{ flex: i === 0 ? 1.4 : 1, fontSize: 10, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" }, i > 0 && { textAlign: "right" }]}>{h}</Text>
                ))}
              </View>
              {pageRows.length === 0 ? (
                <Text style={mt.empty}>{t("Aucune donnée", "لا توجد بيانات")}</Text>
              ) : pageRows.map((r, i) => (
                <View key={i} style={[mt.row, { paddingHorizontal: 8 }, i === pageRows.length - 1 && { borderBottomWidth: 0 }]}>
                  <Text style={{ flex: 1.4, fontSize: 12, fontWeight: "600", color: colors.text }}>{r.date}</Text>
                  <Text style={{ flex: 1, fontSize: 12, textAlign: "right", color: colors.text }}>{fmtNum(r.marge)}</Text>
                  <Text style={{ flex: 1, fontSize: 12, textAlign: "right", color: "#b45309" }}>{fmtNum(r.retours)}</Text>
                  <Text style={{ flex: 1, fontSize: 12, textAlign: "right", color: "#b45309" }}>{fmtNum(r.charges)}</Text>
                  <Text style={{ flex: 1, fontSize: 12, textAlign: "right", fontWeight: "800", color: Number(r.benefice) < 0 ? colors.danger : colors.success }}>{fmtNum(r.benefice)}</Text>
                </View>
              ))}
              {rows.length > 0 && (
                <View style={[mt.row, { backgroundColor: "#fff1f2", borderTopWidth: 2, borderTopColor: "#fecdd3", paddingHorizontal: 8 }]}>
                  <Text style={{ flex: 1.4, fontSize: 11, fontWeight: "800", color: "#9f1239" }}>TOTAL</Text>
                  <Text style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "700", color: "#9f1239" }}>{fmtNum(totals.marge)}</Text>
                  <Text style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "700", color: "#9f1239" }}>{fmtNum(totals.retours)}</Text>
                  <Text style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "700", color: "#9f1239" }}>{fmtNum(totals.charges)}</Text>
                  <Text style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: "800", color: "#9f1239" }}>{fmtNum(totals.benefice)}</Text>
                </View>
              )}
            </View>
          </ScrollView>
          {totalPages > 1 && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8 }}>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>{Math.min((page-1)*PAGE+1,rows.length)}-{Math.min(page*PAGE,rows.length)} / {rows.length}</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Pressable onPress={() => setPage(p => Math.max(1, p-1))} disabled={page <= 1} style={[pg.btn, page <= 1 && { opacity: 0.3 }]}><Feather name="chevron-left" size={16} color={colors.text} /></Pressable>
                <Pressable onPress={() => setPage(p => Math.min(totalPages, p+1))} disabled={page >= totalPages} style={[pg.btn, page >= totalPages && { opacity: 0.3 }]}><Feather name="chevron-right" size={16} color={colors.text} /></Pressable>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ─── VENTE+ tab ───────────────────────────────────────────────────────────────
function VentePlusTab({ t, currency, canViewProfit }: { t: (fr: string, ar: string) => string; currency: string; canViewProfit: boolean }) {
  const [preset, setPreset]   = useState<DatePreset>("mois");
  const [dateFrom, setDateFrom] = useState(monthStartStr());
  const [dateTo, setDateTo]   = useState(todayStr());
  const [search, setSearch]   = useState("");
  const [sortCol, setSortCol] = useState<"montant" | "qte_vendue" | "benefice">("montant");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage]       = useState(1);
  const [selected, setSelected] = useState<VentePlusRow | null>(null);
  const PAGE = 15;

  function applyPreset(p: DatePreset) {
    setPreset(p); setPage(1);
    if (p === "jour")   { setDateFrom(todayStr());      setDateTo(todayStr()); }
    else if (p === "30j")   { setDateFrom(daysAgoStr(30));  setDateTo(todayStr()); }
    else if (p === "mois")  { setDateFrom(monthStartStr()); setDateTo(todayStr()); }
    else if (p === "annee") { setDateFrom(yearStartStr());  setDateTo(todayStr()); }
  }

  const params = new URLSearchParams({ dateFrom, dateTo });
  const qkey = ["dash-vente-plus", dateFrom, dateTo];
  const { data: allRows = [], isLoading, isError } = useDash<VentePlusRow[]>(qkey, `/api/erp/dashboard/ventes-produits?${params}`);

  const filtered = useMemo(() => {
    if (!search.trim()) return allRows;
    const q = search.toLowerCase();
    return allRows.filter(r => r.designation.toLowerCase().includes(q) || r.marque.toLowerCase().includes(q) || r.famille.toLowerCase().includes(q));
  }, [allRows, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = Number(a[sortCol] ?? 0);
      const bv = Number(b[sortCol] ?? 0);
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [filtered, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const pageRows = sorted.slice((page - 1) * PAGE, page * PAGE);
  const gTot = sorted.reduce((a, r) => ({ montant: a.montant + Number(r.montant), qte: a.qte + Number(r.qte_vendue), benefice: a.benefice + Number(r.benefice) }), { montant: 0, qte: 0, benefice: 0 });

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
    setPage(1);
  }

  return (
    <View style={{ gap: 12 }}>
      <DatePresetBar preset={preset} onPreset={applyPreset} dateFrom={dateFrom} dateTo={dateTo} onFrom={(v) => { setDateFrom(v); setPage(1); }} onTo={(v) => { setDateTo(v); setPage(1); }} t={t} />
      <TextInput
        style={[dp.input, { marginTop: 0 }]}
        value={search} onChangeText={(v) => { setSearch(v); setPage(1); }}
        placeholder={t("Rechercher un produit…", "بحث عن منتج…")}
        placeholderTextColor={colors.textMuted}
      />
      {/* Sort controls */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {([["montant", t("Montant", "المبلغ")], ["qte_vendue", t("Qté", "الكمية")], ...(canViewProfit ? [["benefice", t("Bénéfice", "الربح")]] : [])] as [typeof sortCol, string][]).map(([col, label]) => (
          <Pressable key={col} onPress={() => toggleSort(col)} style={[dp.pill, sortCol === col && dp.pillOn]}>
            <Text style={[dp.txt, sortCol === col && dp.txtOn]}>
              {label} {sortCol === col ? (sortDir === "desc" ? "↓" : "↑") : ""}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <STitle>{t("Articles vendus", "المنتجات المباعة")} ({sorted.length})</STitle>

      {isLoading ? <TabLoading /> : isError ? <TabError t={t} /> : (
        <View style={{ gap: 8 }}>
          {pageRows.length === 0 ? (
            <Text style={mt.empty}>{t("Aucun article", "لا توجد مقالات")}</Text>
          ) : pageRows.map((r, i) => (
            <Pressable key={`${r.id}-${i}`} onPress={() => setSelected(r)}
              style={[vp.row, r.row_type === "retour" && vp.retourRow]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={vp.name} numberOfLines={1}>{r.designation}</Text>
                <Text style={vp.meta}>{[r.marque, r.famille].filter(Boolean).join(" · ")}</Text>
                {r.row_type === "retour" && (
                  <View style={vp.retourBadge}><Text style={vp.retourBadgeTxt}>{t("RETOUR", "مرتجع")}</Text></View>
                )}
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text style={vp.amount}>{fmtNum(r.montant)} {currency}</Text>
                <Text style={vp.qty}>{t("Qté", "كمية")}: {r.qte_vendue}</Text>
                {canViewProfit && <Text style={[vp.profit, { color: Number(r.benefice) < 0 ? colors.danger : colors.success }]}>{fmtNum(r.benefice)} {currency}</Text>}
              </View>
            </Pressable>
          ))}
          {/* Grand total */}
          <View style={[mt.head, { backgroundColor: "#fff1f2", borderRadius: 8, borderWidth: 1, borderColor: "#fecdd3" }]}>
            <Text style={{ flex: 1, fontSize: 11, fontWeight: "800", color: "#9f1239" }}>TOTAL ({sorted.length})</Text>
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#9f1239" }}>Qté: {gTot.qte.toLocaleString()}</Text>
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#9f1239", marginLeft: 8 }}>{fmtNum(gTot.montant)} {currency}</Text>
            {canViewProfit && <Text style={{ fontSize: 11, fontWeight: "800", color: gTot.benefice < 0 ? colors.danger : colors.success, marginLeft: 8 }}>{fmtNum(gTot.benefice)} {currency}</Text>}
          </View>
          {/* Pagination */}
          {totalPages > 1 && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>{Math.min((page-1)*PAGE+1,sorted.length)}-{Math.min(page*PAGE,sorted.length)} / {sorted.length}</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Pressable onPress={() => setPage(p => Math.max(1, p-1))} disabled={page <= 1} style={[pg.btn, page <= 1 && { opacity: 0.3 }]}><Feather name="chevron-left" size={16} color={colors.text} /></Pressable>
                <Pressable onPress={() => setPage(p => Math.min(totalPages, p+1))} disabled={page >= totalPages} style={[pg.btn, page >= totalPages && { opacity: 0.3 }]}><Feather name="chevron-right" size={16} color={colors.text} /></Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Product detail sheet */}
      <DetailSheet visible={selected != null} onClose={() => setSelected(null)}
        title={selected?.designation ?? ""}>
        {selected && (
          <View style={{ gap: 12 }}>
            {[
              [t("Marque", "الماركة"), selected.marque || "—"],
              [t("Famille", "العائلة"), selected.famille || "—"],
              [t("Référence", "المرجع"), selected.reference || "—"],
              [t("Stock actuel", "المخزون الحالي"), String(selected.stock)],
              [t("Prix catalogue", "سعر الكتالوج"), selected.price ? `${fmtNum(selected.price)} ${currency}` : "—"],
              [t("Qté vendue", "الكمية المباعة"), String(selected.qte_vendue)],
              [t("PU moyen", "متوسط سعر البيع"), `${fmtNum(selected.pu)} ${currency}`],
              [t("Montant total", "المبلغ الإجمالي"), `${fmtNum(selected.montant)} ${currency}`],
              ...(canViewProfit ? [[t("Bénéfice", "الربح"), `${fmtNum(selected.benefice)} ${currency}`]] : []),
            ].map(([label, val]) => (
              <View key={label} style={gen.detailRow}>
                <Text style={{ fontSize: 13, color: colors.textMuted }}>{label}</Text>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }}>{val}</Text>
              </View>
            ))}
          </View>
        )}
      </DetailSheet>
    </View>
  );
}

const vp = StyleSheet.create({
  row: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, flexDirection: "row", gap: 8 },
  retourRow: { backgroundColor: "#fffbeb", borderColor: "#fde68a" },
  name: { fontSize: 14, fontWeight: "700", color: colors.text },
  meta: { fontSize: 11, color: colors.textMuted },
  amount: { fontSize: 14, fontWeight: "700", color: colors.text },
  qty: { fontSize: 11, color: colors.textMuted },
  profit: { fontSize: 12, fontWeight: "700" },
  retourBadge: { backgroundColor: "#fef3c7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: "flex-start" },
  retourBadgeTxt: { fontSize: 9, fontWeight: "700", color: "#92400e" },
});

// ─── CLIENTS tab ──────────────────────────────────────────────────────────────
function ClientsTab({ t, currency }: { t: (fr: string, ar: string) => string; currency: string }) {
  const q = useDash<ClientRow[]>(["dash-clients"], "/api/erp/dashboard/client-receivables");
  const total = (q.data ?? []).reduce((s, r) => s + Number(r.balance ?? 0), 0);
  if (q.isLoading) return <TabLoading />;
  if (q.isError) return <TabError t={t} />;
  return (
    <View style={{ gap: 14 }}>
      <KpiRow>
        <KpiCard icon="users" labelFr="Clients avec solde" labelAr="عملاء لديهم رصيد" value={String((q.data ?? []).length)} t={t} />
        <KpiCard icon="trending-up" labelFr="Total Créances" labelAr="إجمالي الذمم" value={fmtNum(total, currency)} t={t} variant="negative" />
      </KpiRow>
      <MTable
        headers={[t("Client", "العميل"), t("Solde dû", "المبلغ المستحق")]}
        rows={(q.data ?? []).map((r) => [
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>{r.name}</Text>,
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.danger }}>{fmtNum(r.balance)} {currency}</Text>,
        ])}
        emptyText={t("Aucun client avec un solde.", "لا يوجد عميل لديه رصيد.")}
      />
    </View>
  );
}

// ─── EMPLOYÉS tab ─────────────────────────────────────────────────────────────
function EmployesTab({ t, currency }: { t: (fr: string, ar: string) => string; currency: string }) {
  const q = useDash<Employee[]>(["dash-employes"], "/api/erp/employees");
  if (q.isLoading) return <TabLoading />;
  if (q.isError) return <TabError t={t} />;
  const active = (q.data ?? []).filter(e => e.status === "active");
  const totalSalary = active.reduce((s, e) => s + Number(e.salary ?? 0), 0);
  const statusColors: Record<string, string> = { active: colors.success, inactive: colors.textMuted, on_leave: "#b45309", terminated: colors.danger };
  const statusLabels: Record<string, [string, string]> = {
    active: ["Actif", "نشط"], inactive: ["Inactif", "غير نشط"],
    on_leave: ["En congé", "في إجازة"], terminated: ["Résilié", "منتهي"],
  };
  return (
    <View style={{ gap: 14 }}>
      <KpiRow>
        <KpiCard icon="user-check" labelFr="Employés actifs" labelAr="الموظفون النشطون" value={String(active.length)} t={t} />
        <KpiCard icon="dollar-sign" labelFr="Masse salariale" labelAr="إجمالي الرواتب" value={fmtNum(totalSalary, currency)} t={t} />
      </KpiRow>
      <MTable
        headers={[t("Nom", "الاسم"), t("Poste", "المنصب"), t("Salaire", "الراتب"), t("Statut", "الحالة")]}
        rows={(q.data ?? []).map((e) => [
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text }}>{e.name}</Text>,
          <Text style={{ fontSize: 11, color: colors.textMuted }}>{e.position}</Text>,
          <Text style={{ fontSize: 11, color: colors.text }}>{fmtNum(e.salary)}</Text>,
          <Text style={{ fontSize: 11, fontWeight: "700", color: statusColors[e.status] ?? colors.text }}>{t(...(statusLabels[e.status] ?? [e.status, e.status]))}</Text>,
        ])}
        emptyText={t("Aucun employé.", "لا يوجد موظف.")}
      />
    </View>
  );
}

// ─── STOCK tab ────────────────────────────────────────────────────────────────
function StockTab({ t, currency, lang }: { t: (fr: string, ar: string) => string; currency: string; lang: string }) {
  const q = useDash<StockRow[]>(["dash-stock-detail"], "/api/erp/dashboard/stock-detail");
  const total = (q.data ?? []).reduce((s, r) => s + Number(r.valeur ?? 0), 0);
  if (q.isLoading) return <TabLoading />;
  if (q.isError) return <TabError t={t} />;
  return (
    <View style={{ gap: 14 }}>
      <KpiRow>
        <KpiCard icon="package" labelFr="Références en stock" labelAr="المراجع في المخزون" value={String((q.data ?? []).length)} t={t} />
        <KpiCard icon="layers" labelFr="Valeur totale stock" labelAr="القيمة الإجمالية" value={fmtNum(total, currency)} t={t} />
      </KpiRow>
      <MTable
        headers={[t("Produit", "المنتج"), t("Stock", "المخزون"), t("Valeur", "القيمة")]}
        rows={(q.data ?? []).map((r) => [
          <View>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text }} numberOfLines={1}>{lang === "ar" ? (r.nameAr || r.nameEn) : (r.nameEn || r.nameAr)}</Text>
            {r.reference ? <Text style={{ fontSize: 10, color: colors.textMuted }}>{r.reference}</Text> : null}
          </View>,
          <Text style={{ fontSize: 12, textAlign: "right", color: colors.text }}>{r.stock}</Text>,
          <Text style={{ fontSize: 12, textAlign: "right", fontWeight: "700", color: colors.text }}>{fmtNum(r.valeur)}</Text>,
        ])}
        emptyText={t("Aucun produit en stock.", "لا يوجد منتج.")}
      />
    </View>
  );
}

// ─── CAISSES tab ──────────────────────────────────────────────────────────────
function CaissesTab({ t, currency }: { t: (fr: string, ar: string) => string; currency: string }) {
  const q = useDash<CaissesData>(["dash-caisses"], "/api/erp/dashboard/caisses");
  if (q.isLoading) return <TabLoading />;
  if (q.isError || !q.data) return <TabError t={t} />;
  const mainCaisses  = q.data.caisses.filter(c => c.kind === "main");
  const staffCaisses = q.data.caisses.filter(c => c.kind === "staff");
  return (
    <View style={{ gap: 14 }}>
      <KpiRow>
        <KpiCard icon="credit-card" labelFr="Trésorerie totale" labelAr="إجمالي الصناديق" value={fmtNum(q.data.total, currency)} t={t} variant="positive" />
        <KpiCard icon="users" labelFr="Caisses staff" labelAr="صناديق الموظفين" value={String(staffCaisses.length)} t={t} />
      </KpiRow>
      {mainCaisses.length > 0 && (
        <>
          <STitle>{t("Caisse principale", "الصندوق الرئيسي")}</STitle>
          <MTable
            headers={[t("Type", "النوع"), t("Solde", "الرصيد")]}
            rows={mainCaisses.map((c) => [
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>{t("Caisse principale", "الصندوق الرئيسي")}</Text>,
              <Text style={{ fontSize: 13, fontWeight: "700", color: Number(c.balance) >= 0 ? colors.success : colors.danger }}>{fmtNum(c.balance)} {currency}</Text>,
            ])}
          />
        </>
      )}
      {staffCaisses.length > 0 && (
        <>
          <STitle>{t("Caisses staff", "صناديق الموظفين")}</STitle>
          <MTable
            headers={[t("Employé", "الموظف"), t("Solde", "الرصيد")]}
            rows={staffCaisses.map((c) => [
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>{c.owner_name ?? t("(sans nom)", "(بدون اسم)")}</Text>,
              <Text style={{ fontSize: 13, fontWeight: "700", color: Number(c.balance) >= 0 ? colors.success : colors.danger }}>{fmtNum(c.balance)} {currency}</Text>,
            ])}
          />
        </>
      )}
    </View>
  );
}

// ─── FOURNISSEURS tab ─────────────────────────────────────────────────────────
function FournisseursTab({ t, currency }: { t: (fr: string, ar: string) => string; currency: string }) {
  const q = useDash<SupplierRow[]>(["dash-suppliers"], "/api/erp/dashboard/supplier-debts");
  const total = (q.data ?? []).reduce((s, r) => s + Number(r.balance ?? 0), 0);
  if (q.isLoading) return <TabLoading />;
  if (q.isError) return <TabError t={t} />;
  return (
    <View style={{ gap: 14 }}>
      <KpiRow>
        <KpiCard icon="truck" labelFr="Fournisseurs créditeurs" labelAr="موردون دائنون" value={String((q.data ?? []).length)} t={t} />
        <KpiCard icon="alert-triangle" labelFr="Total Dettes" labelAr="إجمالي الديون" value={fmtNum(total, currency)} t={t} variant="negative" />
      </KpiRow>
      <MTable
        headers={[t("Fournisseur", "المورد"), t("Solde dû", "المبلغ المستحق")]}
        rows={(q.data ?? []).map((r) => [
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>{r.name}</Text>,
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.danger }}>{fmtNum(r.balance)} {currency}</Text>,
        ])}
        emptyText={t("Aucun fournisseur avec un solde.", "لا يوجد مورد لديه رصيد.")}
      />
    </View>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
type TabKey = "general" | "ventes" | "benefice" | "vente_plus" | "clients" | "employes" | "stock" | "caisses" | "fournisseurs";

export default function Dashboard() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "dashboard" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  // Mobile PermAction only has view/create/edit/delete — profit tab is admin-only
  const canViewProfit = isAdmin;

  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [refreshKey, setRefreshKey] = useState(0);

  type TabDef = { key: TabKey; fr: string; ar: string; hidden?: boolean };
  const tabs: TabDef[] = ([
    { key: "general",      fr: "Général",      ar: "عام" },
    { key: "ventes",       fr: "Ventes",        ar: "المبيعات" },
    { key: "benefice",     fr: "Bénéfice",      ar: "الأرباح",  hidden: !canViewProfit },
    { key: "vente_plus",   fr: "Vente+",        ar: "مقالات" },
    { key: "clients",      fr: "Clients",       ar: "العملاء" },
    { key: "employes",     fr: "Employés",      ar: "الموظفون" },
    { key: "stock",        fr: "Stock",         ar: "المخزون" },
    { key: "caisses",      fr: "Caisses",       ar: "الصناديق" },
    { key: "fournisseurs", fr: "Fournisseurs",  ar: "الموردون" },
  ] as TabDef[]).filter(tb => !tb.hidden);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Tab bar */}
      <View style={dash.tabBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={dash.tabContent}>
          {tabs.map((tb) => (
            <Pressable key={tb.key} onPress={() => setActiveTab(tb.key)} style={[dash.tab, activeTab === tb.key && dash.tabActive]}>
              <Text style={[dash.tabTxt, activeTab === tb.key && dash.tabTxtActive]}>{t(tb.fr, tb.ar)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Tab content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => setRefreshKey(k => k + 1)} />}
      >
        {activeTab === "general"      && <GeneralTab      t={t} currency={currency} lang={lang} />}
        {activeTab === "ventes"       && <VentesTab       t={t} currency={currency} canViewProfit={canViewProfit} />}
        {activeTab === "benefice"     && <BeneficeTab     t={t} currency={currency} />}
        {activeTab === "vente_plus"   && <VentePlusTab    t={t} currency={currency} canViewProfit={canViewProfit} />}
        {activeTab === "clients"      && <ClientsTab      t={t} currency={currency} />}
        {activeTab === "employes"     && <EmployesTab     t={t} currency={currency} />}
        {activeTab === "stock"        && <StockTab        t={t} currency={currency} lang={lang} />}
        {activeTab === "caisses"      && <CaissesTab      t={t} currency={currency} />}
        {activeTab === "fournisseurs" && <FournisseursTab t={t} currency={currency} />}
      </ScrollView>
    </View>
  );
}

const dash = StyleSheet.create({
  tabBar: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  tabContent: { flexDirection: "row", paddingHorizontal: 4 },
  tab: { paddingHorizontal: 14, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabTxt: { fontSize: 13, fontWeight: "500", color: colors.textMuted },
  tabTxtActive: { color: colors.primary, fontWeight: "700" },
});
