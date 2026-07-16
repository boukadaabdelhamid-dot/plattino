import React, { useState, useMemo } from "react";
import {
  View, Text, StyleSheet, FlatList, ScrollView,
  Pressable, RefreshControl, TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import {
  useGetAccountingSummary,
  useGetTransactions,
  getGetAccountingSummaryQueryKey,
  getGetTransactionsQueryKey,
  type Transaction,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Card, SectionTitle, Badge, Button, LoadingView } from "@/components/ui";
import { DateField } from "@/components/DateField";
import { Fab } from "@/components/Fab";
import { colors } from "@/lib/colors";
import { Feather } from "@expo/vector-icons";

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = ["sales", "purchase", "salary", "rent", "utilities", "marketing", "other"] as const;

const CATEGORY_LABEL: Record<string, [string, string]> = {
  sales:     ["Ventes",    "المبيعات"],
  purchase:  ["Achats",    "المشتريات"],
  salary:    ["Salaires",  "الرواتب"],
  rent:      ["Loyer",     "الإيجار"],
  utilities: ["Charges",   "الخدمات"],
  marketing: ["Marketing", "التسويق"],
  other:     ["Autre",     "أخرى"],
};

const PAGE_SIZES = [10, 25, 50, 0]; // 0 = Tous

type GroupBy = "none" | "jour" | "mois" | "annee";

// ─── Chip helper ─────────────────────────────────────────────────────────────

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[chipStyles.base, active && chipStyles.active]}
    >
      <Text style={[chipStyles.label, active && chipStyles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  base: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: 6,
  },
  active: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { fontSize: 12.5, fontWeight: "500", color: colors.textMuted },
  labelActive: { color: "#fff" },
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function Accounting() {
  const { ready, can } = useProtectedRoute({ section: "accounting" });
  const { t, lang } = useLang();
  const router = useRouter();
  const currency = lang === "ar" ? "دج" : "DA";

  // ── Remote data ──────────────────────────────────────────────────────────
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } =
    useGetAccountingSummary({ query: { enabled: ready, queryKey: getGetAccountingSummaryQueryKey() } });

  const { data: transactions, isLoading, refetch, isRefetching } =
    useGetTransactions({ query: { enabled: ready, queryKey: getGetTransactionsQueryKey() } });

  // ── Filter state ─────────────────────────────────────────────────────────
  const [search,         setSearch]        = useState("");
  const [filterType,     setFilterType]    = useState<"all" | "income" | "expense">("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [groupBy,        setGroupBy]       = useState<GroupBy>("none");
  const [dateFrom,       setDateFrom]      = useState<Date | null>(null);
  const [dateTo,         setDateTo]        = useState<Date | null>(null);

  // ── Pagination state ─────────────────────────────────────────────────────
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset page to 1 whenever filters change
  function resetPage() { setPage(1); }

  // ── Derived: sorted all transactions ────────────────────────────────────
  const sorted = useMemo(
    () => [...(transactions ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions],
  );

  // ── Derived: filtered transactions ───────────────────────────────────────
  const filteredTx = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((tx) => {
      if (filterType !== "all" && tx.type !== filterType) return false;
      if (filterCategory !== "all" && tx.category !== filterCategory) return false;
      if (q && !tx.description?.toLowerCase().includes(q) && !(tx.reference ?? "").toLowerCase().includes(q)) return false;
      if (groupBy !== "none" && (dateFrom || dateTo)) {
        const d = new Date(tx.date);
        if (groupBy === "jour") {
          if (dateFrom) {
            const from = new Date(dateFrom.toISOString().slice(0, 10));
            if (d < from) return false;
          }
          if (dateTo) {
            const end = new Date(dateTo.toISOString().slice(0, 10));
            end.setHours(23, 59, 59, 999);
            if (d > end) return false;
          }
        } else if (groupBy === "mois") {
          if (dateFrom) {
            if (d.getFullYear() < dateFrom.getFullYear() ||
              (d.getFullYear() === dateFrom.getFullYear() && d.getMonth() < dateFrom.getMonth())) return false;
          }
          if (dateTo) {
            if (d.getFullYear() > dateTo.getFullYear() ||
              (d.getFullYear() === dateTo.getFullYear() && d.getMonth() > dateTo.getMonth())) return false;
          }
        } else if (groupBy === "annee") {
          if (dateFrom && d.getFullYear() < dateFrom.getFullYear()) return false;
          if (dateTo   && d.getFullYear() > dateTo.getFullYear())   return false;
        }
      }
      return true;
    });
  }, [sorted, filterType, filterCategory, search, groupBy, dateFrom, dateTo]);

  // ── Derived: KPI (recalculate on filtered when active) ──────────────────
  const isFiltered = filterType !== "all" || filterCategory !== "all" ||
    (groupBy !== "none" && (dateFrom !== null || dateTo !== null)) || search.trim() !== "";

  const kpiIncome   = isFiltered ? filteredTx.filter(tx => tx.type === "income").reduce((s, tx) => s + Number(tx.amount), 0) : Number(summary?.totalIncome ?? 0);
  const kpiExpenses = isFiltered ? filteredTx.filter(tx => tx.type === "expense").reduce((s, tx) => s + Number(tx.amount), 0) : Number(summary?.totalExpenses ?? 0);
  const kpiBalance  = isFiltered ? kpiIncome - kpiExpenses : Number(summary?.netBalance ?? 0);

  // ── Derived: pagination ──────────────────────────────────────────────────
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(filteredTx.length / pageSize));
  const pagedTx    = pageSize === 0 ? filteredTx : filteredTx.slice((page - 1) * pageSize, page * pageSize);

  // ── Helpers ──────────────────────────────────────────────────────────────
  function resetFilters() {
    setSearch(""); setFilterType("all"); setFilterCategory("all");
    setGroupBy("none"); setDateFrom(null); setDateTo(null);
    setPage(1);
  }

  function changeType(v: "all" | "income" | "expense") { setFilterType(v); resetPage(); }
  function changeCat(v: string)  { setFilterCategory(v); resetPage(); }
  function changeGroupBy(v: GroupBy) { setGroupBy(v); setDateFrom(null); setDateTo(null); resetPage(); }
  function changeSearch(v: string) { setSearch(v); resetPage(); }

  if (!ready) return null;

  const canCreate = can("accounting", "create");

  // ── Page numbers builder ──────────────────────────────────────────────────
  function buildPages(current: number, total: number): (number | "...")[] {
    const pages: (number | "...")[] = [];
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (current > 3) pages.push("...");
      for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
      if (current < total - 2) pages.push("...");
      pages.push(total);
    }
    return pages;
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  const pageSizeLabel = (ps: number) => ps === 0 ? t("Tous", "الكل") : String(ps);

  const listHeader = (
    <View>
      {/* ── KPI cards ─────────────────────────────────────────── */}
      <View style={styles.summaryWrap}>
        <View style={styles.summaryRow}>
          <Card style={{ flex: 1 }}>
            <SectionTitle>{t(isFiltered ? "Revenus filtrés" : "Revenus", isFiltered ? "الدخل (مصفى)" : "الدخل")}</SectionTitle>
            <Text style={[styles.big, { color: "#15803D" }]}>{kpiIncome.toLocaleString("fr-FR")} {currency}</Text>
          </Card>
          <Card style={{ flex: 1 }}>
            <SectionTitle>{t(isFiltered ? "Dépenses filtrées" : "Dépenses", isFiltered ? "المصاريف (مصفى)" : "المصاريف")}</SectionTitle>
            <Text style={[styles.big, { color: colors.danger }]}>{kpiExpenses.toLocaleString("fr-FR")} {currency}</Text>
          </Card>
        </View>
        <Card style={{ marginTop: 12, marginHorizontal: 16 }}>
          <SectionTitle>{t(isFiltered ? "Solde (filtré)" : "Solde (Grand Livre)", isFiltered ? "الرصيد (مصفى)" : "الرصيد (السجل العام)")}</SectionTitle>
          <Text style={styles.big}>{kpiBalance.toLocaleString("fr-FR")} {currency}</Text>
        </Card>
      </View>

      {/* ── Filters ───────────────────────────────────────────── */}
      <View style={styles.filtersWrap}>
        {/* Search */}
        <View style={styles.searchBar}>
          <Feather name="search" size={16} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={changeSearch}
            placeholder={t("Rechercher description / référence…", "بحث في الوصف / المرجع…")}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable onPress={() => changeSearch("")}>
              <Feather name="x" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Type chips */}
        <Text style={styles.filterLabel}>{t("Type", "النوع")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <Chip label={t("Tous", "الكل")}     active={filterType === "all"}     onPress={() => changeType("all")} />
          <Chip label={t("Revenus", "دخل")}   active={filterType === "income"}  onPress={() => changeType("income")} />
          <Chip label={t("Dépenses", "مصروف")} active={filterType === "expense"} onPress={() => changeType("expense")} />
        </ScrollView>

        {/* Category chips */}
        <Text style={styles.filterLabel}>{t("Catégorie", "الفئة")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <Chip label={t("Toutes", "الكل")} active={filterCategory === "all"} onPress={() => changeCat("all")} />
          {CATEGORIES.map((c) => {
            const [fr, ar] = CATEGORY_LABEL[c];
            return <Chip key={c} label={t(fr, ar)} active={filterCategory === c} onPress={() => changeCat(c)} />;
          })}
        </ScrollView>

        {/* Période chips (style Ventes) */}
        <Text style={styles.filterLabel}>{t("Période", "الفترة")}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <Chip label={t("Aucune",   "لا شيء")} active={groupBy === "none"}  onPress={() => changeGroupBy("none")} />
          <Chip label={t("Par jour", "يومياً")} active={groupBy === "jour"}  onPress={() => changeGroupBy("jour")} />
          <Chip label={t("Par mois", "شهرياً")} active={groupBy === "mois"}  onPress={() => changeGroupBy("mois")} />
          <Chip label={t("Par année","سنوياً")} active={groupBy === "annee"} onPress={() => changeGroupBy("annee")} />
        </ScrollView>

        {/* Début / Fin date pickers — shown whenever a Période is selected */}
        {groupBy !== "none" && (
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <DateField
                label={t("Début", "البداية")}
                value={dateFrom}
                onChange={(d) => { setDateFrom(d); resetPage(); }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <DateField
                label={t("Fin", "النهاية")}
                value={dateTo}
                onChange={(d) => { setDateTo(d); resetPage(); }}
              />
            </View>
          </View>
        )}

        {/* Reset button */}
        {isFiltered && (
          <Pressable onPress={resetFilters} style={styles.resetBtn}>
            <Feather name="x-circle" size={14} color={colors.primary} />
            <Text style={styles.resetLabel}>{t("Réinitialiser les filtres", "إعادة تعيين الفلاتر")}</Text>
          </Pressable>
        )}
      </View>

      {/* ── List header bar ───────────────────────────────────── */}
      <View style={styles.listBar}>
        <Text style={styles.listTitle}>
          {t("Transactions", "المعاملات")} ({filteredTx.length}{isFiltered ? ` / ${sorted.length}` : ""})
        </Text>
        {/* Page size selector chips */}
        <View style={styles.pageSizeRow}>
          {PAGE_SIZES.map((ps) => (
            <Pressable
              key={ps}
              onPress={() => { setPageSize(ps); setPage(1); }}
              style={[styles.psChip, pageSize === ps && styles.psChipActive]}
            >
              <Text style={[styles.psLabel, pageSize === ps && styles.psLabelActive]}>{pageSizeLabel(ps)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );

  // ── Footer: count + numbered page navigation ──────────────────────────────
  const listFooter = pageSize !== 0 && totalPages > 0 ? (
    <View style={{ marginTop: 8, marginBottom: 24 }}>
      {/* Affichage N–N sur N */}
      {filteredTx.length > 0 && (
        <Text style={styles.pageCount}>
          {t(
            `Affichage ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredTx.length)} sur ${filteredTx.length} transaction(s)`,
            `عرض ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, filteredTx.length)} من ${filteredTx.length}`
          )}
        </Text>
      )}
      {/* Numbered navigation */}
      {totalPages > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pageNav}>
          {/* Préc. */}
          <Pressable
            onPress={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
          >
            <Feather name="chevron-left" size={14} color={page <= 1 ? colors.border : colors.primary} />
            <Text style={{ fontSize: 12, color: page <= 1 ? colors.border : colors.primary, marginLeft: 2 }}>
              {t("Préc.", "السابق")}
            </Text>
          </Pressable>

          {/* Page number buttons */}
          {buildPages(page, totalPages).map((pg, i) =>
            pg === "..." ? (
              <Text key={`e${i}`} style={styles.ellipsis}>…</Text>
            ) : (
              <Pressable
                key={pg}
                onPress={() => setPage(pg as number)}
                style={[styles.pageNumBtn, page === pg && styles.pageNumBtnActive]}
              >
                <Text style={[styles.pageNumLabel, page === pg && styles.pageNumLabelActive]}>{pg}</Text>
              </Pressable>
            )
          )}

          {/* Suiv. */}
          <Pressable
            onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}
          >
            <Text style={{ fontSize: 12, color: page >= totalPages ? colors.border : colors.primary, marginRight: 2 }}>
              {t("Suiv.", "التالي")}
            </Text>
            <Feather name="chevron-right" size={14} color={page >= totalPages ? colors.border : colors.primary} />
          </Pressable>
        </ScrollView>
      )}
    </View>
  ) : <View style={{ height: 24 }} />;

  if (isLoading && !transactions) return <LoadingView />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={pagedTx}
        keyExtractor={(tx) => String(tx.id)}
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        ListEmptyComponent={
          <View style={{ alignItems: "center", padding: 32 }}>
            <Feather name="inbox" size={36} color={colors.border} />
            <Text style={{ color: colors.textMuted, marginTop: 12, fontSize: 14 }}>
              {t("Aucune transaction", "لا توجد معاملات")}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => { refetch(); refetchSummary(); }}
          />
        }
        contentContainerStyle={{ paddingBottom: 80 }}
        renderItem={({ item: tx }: { item: Transaction }) => {
          const [fr, ar] = CATEGORY_LABEL[tx.category ?? ""] ?? [tx.category, tx.category];
          const isIncome = tx.type === "income";
          return (
            <Card style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.desc} numberOfLines={1}>{tx.description}</Text>
                <Text style={[styles.amount, { color: isIncome ? "#15803D" : colors.danger }]}>
                  {isIncome ? "+" : "-"}{Number(tx.amount).toLocaleString("fr-FR")} {currency}
                </Text>
              </View>
              <View style={styles.rowBetween}>
                <Badge label={t(fr, ar)} tone={isIncome ? "success" : "danger"} />
                <Text style={styles.mutedSmall}>{new Date(tx.date).toLocaleDateString("fr-FR")}</Text>
              </View>
              {tx.reference ? <Text style={styles.mutedSmall}>{tx.reference}</Text> : null}
            </Card>
          );
        }}
      />
      {canCreate ? (
        <Fab onPress={() => router.push("/accounting/transaction-new" as never)} testID="button-new-transaction" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  summaryWrap:    { paddingTop: 16 },
  summaryRow:     { flexDirection: "row", gap: 12, paddingHorizontal: 16 },
  big:            { fontSize: 18, fontWeight: "700", color: colors.primary, marginTop: 2 },

  filtersWrap:    { marginHorizontal: 16, marginTop: 14, marginBottom: 4 },
  filterLabel:    { fontSize: 11.5, fontWeight: "600", color: colors.textMuted, marginBottom: 6, marginTop: 8 },
  chipRow:        { marginBottom: 2 },

  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingHorizontal: 12, marginBottom: 2,
  },
  searchInput:    { flex: 1, paddingVertical: 9, fontSize: 13.5, color: colors.text },

  dateRow:        { flexDirection: "row", gap: 8, marginTop: 8 },

  resetBtn:       { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, alignSelf: "flex-start" },
  resetLabel:     { fontSize: 13, color: colors.primary, fontWeight: "500" },

  listBar:        { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 16, marginTop: 16, marginBottom: 6 },
  listTitle:      { fontSize: 14, fontWeight: "700", color: colors.text },
  pageSizeRow:    { flexDirection: "row", gap: 4 },
  psChip:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  psChipActive:   { backgroundColor: colors.primary, borderColor: colors.primary },
  psLabel:        { fontSize: 11, color: colors.textMuted, fontWeight: "500" },
  psLabelActive:  { color: "#fff" },

  // Footer pagination
  pageCount:      { textAlign: "center", fontSize: 12, color: colors.textMuted, marginBottom: 6 },
  pageNav:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 4 },
  pageBtn:        { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  pageBtnDisabled:{ borderColor: colors.border, backgroundColor: colors.background },
  pageNumBtn:     { width: 30, height: 30, borderRadius: 6, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  pageNumBtnActive: { backgroundColor: "#1B3057", borderColor: "#1B3057" },
  pageNumLabel:   { fontSize: 12, color: colors.textMuted, fontWeight: "500" },
  pageNumLabelActive: { color: "#fff" },
  ellipsis:       { fontSize: 12, color: colors.textMuted, paddingHorizontal: 4, lineHeight: 30 },

  card:           { marginHorizontal: 16, marginBottom: 8, gap: 6 },
  rowBetween:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  desc:           { fontSize: 14, fontWeight: "600", color: colors.text, flex: 1 },
  amount:         { fontSize: 14, fontWeight: "700" },
  mutedSmall:     { fontSize: 11.5, color: colors.textMuted },
});
