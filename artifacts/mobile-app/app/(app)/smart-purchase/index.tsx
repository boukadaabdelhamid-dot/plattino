/**
 * Smart Purchase (Besoin d'achat) — two tabs:
 *   "Besoins"  — low-stock products with search + filters + PO builder
 *   "Idées"    — staff purchase suggestions (CRUD)
 *
 * Permission: purchases:view (not admin-only — mirrors ERP behaviour).
 */
import React, { useState, useMemo } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView,
  FlatList, Alert, Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import {
  useCreatePurchaseOrder,
  getGetPurchaseOrdersQueryKey,
  type Product,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useConfirm } from "@/contexts/confirm-context";
import { useMe } from "@/hooks/use-me";
import { SearchBar } from "@/components/ListScreen";
import { Badge, Button, LoadingView, EmptyState } from "@/components/ui";
import { Screen } from "@/components/Screen";
import { Fab } from "@/components/Fab";
import {
  PurchaseOrderForm,
  emptyPurchaseOrderForm,
  type PurchaseOrderFormValues,
  type PurchaseOrderLine,
} from "@/components/PurchaseOrderForm";
import { colors } from "@/lib/colors";
import {
  useNeededProducts,
  useFilterOptions,
  usePurchaseSuggestions,
  useDeleteSuggestion,
  useTapSuggestion,
  type NeededRow,
  type NeededFilters,
  type PurchaseSuggestion,
} from "@/hooks/use-smart-purchase";

// ─── Tab bar ─────────────────────────────────────────────────────────────────

type Tab = "besoins" | "idees";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const { t } = useLang();
  return (
    <View style={styles.tabBar}>
      {(["besoins", "idees"] as Tab[]).map((tab) => (
        <Pressable
          key={tab}
          onPress={() => onChange(tab)}
          style={[styles.tabItem, active === tab && styles.tabItemActive]}
        >
          <Text style={[styles.tabText, active === tab && styles.tabTextActive]}>
            {tab === "besoins"
              ? t("Besoins", "المنتجات الناقصة")
              : t("Idées", "الاقتراحات")}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Stock filter pills ───────────────────────────────────────────────────────

type StockFilter = "all" | "rupture" | "low";

function StockPills({
  value, onChange, ruptureTotal, lowTotal,
}: {
  value: StockFilter;
  onChange: (v: StockFilter) => void;
  ruptureTotal: number;
  lowTotal: number;
}) {
  const { t } = useLang();
  const pills: { key: StockFilter; label: string; count?: number }[] = [
    { key: "all",     label: t("Tout",    "الكل") },
    { key: "rupture", label: t("Rupture", "نفاد"),   count: ruptureTotal },
    { key: "low",     label: t("Faible",  "منخفض"),  count: lowTotal },
  ];
  return (
    <View style={styles.pills}>
      {pills.map(({ key, label, count }) => (
        <Pressable
          key={key}
          onPress={() => onChange(key)}
          style={[styles.pill, value === key && styles.pillActive]}
        >
          <Text style={[styles.pillText, value === key && styles.pillTextActive]}>
            {label}{count != null ? ` (${count})` : ""}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Filter modal ─────────────────────────────────────────────────────────────

type ActiveFilters = {
  supplierId: number | null;
  supplierName: string | null;
  familyId: number | null;
  familyName: string | null;
  brandId: number | null;
  brandName: string | null;
  supplierCity: string | null;
  sortBy: "profit" | "qty_sold";
};

const DEFAULT_FILTERS: ActiveFilters = {
  supplierId: null, supplierName: null,
  familyId: null,   familyName: null,
  brandId: null,    brandName: null,
  supplierCity: null,
  sortBy: "profit",
};

function FilterModal({
  visible,
  onClose,
  filters,
  onApply,
  enabled,
}: {
  visible: boolean;
  onClose: () => void;
  filters: ActiveFilters;
  onApply: (f: ActiveFilters) => void;
  enabled: boolean;
}) {
  const { t, lang } = useLang();
  const [local, setLocal] = useState<ActiveFilters>(filters);
  const { data: opts } = useFilterOptions(enabled);

  function reset() { setLocal(DEFAULT_FILTERS); }
  function apply() { onApply(local); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t("Filtres", "الفلاتر")}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Feather name="x" size={22} color={colors.text} />
            </Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
            {/* Sort */}
            <Text style={styles.filterLabel}>{t("Trier par", "ترتيب حسب")}</Text>
            <View style={styles.pills}>
              {(["profit", "qty_sold"] as const).map((s) => (
                <Pressable key={s} onPress={() => setLocal((p) => ({ ...p, sortBy: s }))}
                  style={[styles.pill, local.sortBy === s && styles.pillActive]}>
                  <Text style={[styles.pillText, local.sortBy === s && styles.pillTextActive]}>
                    {s === "profit" ? t("Profit", "الربح") : t("Qté vendue", "الكمية المباعة")}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Family */}
            {opts?.families?.length ? (
              <>
                <Text style={styles.filterLabel}>{t("Famille", "العائلة")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Pressable onPress={() => setLocal((p) => ({ ...p, familyId: null, familyName: null }))}
                    style={[styles.pill, !local.familyId && styles.pillActive]}>
                    <Text style={[styles.pillText, !local.familyId && styles.pillTextActive]}>{t("Tout", "الكل")}</Text>
                  </Pressable>
                  {opts.families.map((f) => (
                    <Pressable key={f.id} onPress={() => setLocal((p) => ({ ...p, familyId: f.id, familyName: lang === "ar" ? f.nameAr : f.nameFr }))}
                      style={[styles.pill, local.familyId === f.id && styles.pillActive]}>
                      <Text style={[styles.pillText, local.familyId === f.id && styles.pillTextActive]}>
                        {lang === "ar" ? f.nameAr : f.nameFr}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {/* Brand */}
            {opts?.brands?.length ? (
              <>
                <Text style={styles.filterLabel}>{t("Marque", "الماركة")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Pressable onPress={() => setLocal((p) => ({ ...p, brandId: null, brandName: null }))}
                    style={[styles.pill, !local.brandId && styles.pillActive]}>
                    <Text style={[styles.pillText, !local.brandId && styles.pillTextActive]}>{t("Tout", "الكل")}</Text>
                  </Pressable>
                  {opts.brands.map((b) => (
                    <Pressable key={b.id} onPress={() => setLocal((p) => ({ ...p, brandId: b.id, brandName: lang === "ar" ? b.nameAr : b.nameFr }))}
                      style={[styles.pill, local.brandId === b.id && styles.pillActive]}>
                      <Text style={[styles.pillText, local.brandId === b.id && styles.pillTextActive]}>
                        {lang === "ar" ? b.nameAr : b.nameFr}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {/* City */}
            {opts?.supplierCities?.length ? (
              <>
                <Text style={styles.filterLabel}>{t("Ville fournisseur", "مدينة المورد")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Pressable onPress={() => setLocal((p) => ({ ...p, supplierCity: null }))}
                    style={[styles.pill, !local.supplierCity && styles.pillActive]}>
                    <Text style={[styles.pillText, !local.supplierCity && styles.pillTextActive]}>{t("Tout", "الكل")}</Text>
                  </Pressable>
                  {opts.supplierCities.map((c) => (
                    <Pressable key={c} onPress={() => setLocal((p) => ({ ...p, supplierCity: c }))}
                      style={[styles.pill, local.supplierCity === c && styles.pillActive]}>
                      <Text style={[styles.pillText, local.supplierCity === c && styles.pillTextActive]}>{c}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
          </ScrollView>

          <View style={styles.modalFooter}>
            <Button label={t("Réinitialiser", "إعادة تعيين")} variant="ghost" onPress={reset} style={{ flex: 1 }} />
            <Button label={t("Appliquer", "تطبيق")} onPress={apply} style={{ flex: 2 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Suggestion card ──────────────────────────────────────────────────────────

function SuggestionCard({
  item, isOwner, isAdmin: admin, onEdit, onDelete, onTap, tapping,
}: {
  item: PurchaseSuggestion;
  isOwner: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTap: () => void;
  tapping: boolean;
}) {
  const { t } = useLang();
  const date = new Date(item.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });

  return (
    <View style={styles.suggestionCard}>
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={styles.suggestionImg} resizeMode="cover" />
      ) : null}
      <View style={styles.suggestionBody}>
        <View style={styles.suggestionRow}>
          <Text style={styles.suggestionName} numberOfLines={2}>{item.product_name}</Text>
          {(isOwner || admin) ? (
            <View style={styles.suggestionActions}>
              <Pressable onPress={onEdit} hitSlop={10} testID={`btn-edit-suggestion-${item.id}`}>
                <Feather name="edit-2" size={16} color={colors.primary} />
              </Pressable>
              <Pressable onPress={onDelete} hitSlop={10} testID={`btn-delete-suggestion-${item.id}`}>
                <Feather name="trash-2" size={16} color={colors.danger} />
              </Pressable>
            </View>
          ) : null}
        </View>

        {item.market_price ? (
          <Text style={styles.suggestionPrice}>
            {t("Prix marché:", "سعر السوق:")} {item.market_price} DA
          </Text>
        ) : null}

        {item.notes ? (
          <Text style={styles.suggestionNotes} numberOfLines={2}>{item.notes}</Text>
        ) : null}

        <View style={styles.suggestionMeta}>
          <Text style={styles.suggestionAuthor}>
            {item.staff_name ?? t("Employé", "موظف")} · {date}
          </Text>
          <Pressable
            onPress={onTap}
            disabled={tapping}
            style={styles.tapBtn}
            testID={`btn-tap-suggestion-${item.id}`}
          >
            <Feather name="thumbs-up" size={13} color={colors.primary} />
            <Text style={styles.tapCount}>{item.demand_count}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SmartPurchase() {
  const { ready, isAdmin } = useProtectedRoute({ section: "purchases" });
  const { t, lang } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const { confirm } = useConfirm();
  const { user } = useMe();

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<Tab>("besoins");

  // ── Besoins state ──
  const [search, setSearch]               = useState("");
  const [stockFilter, setStockFilter]     = useState<StockFilter>("all");
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen]       = useState(false);
  const [selected, setSelected]           = useState<Set<number>>(new Set());
  const [building, setBuilding]           = useState(false);
  const [values, setValues]               = useState<PurchaseOrderFormValues>(emptyPurchaseOrderForm());

  const neededFilters: NeededFilters = useMemo(() => ({
    search: search || undefined,
    stockFilter,
    sortBy: activeFilters.sortBy,
    supplierId: activeFilters.supplierId,
    familyId: activeFilters.familyId,
    brandId: activeFilters.brandId,
    supplierCity: activeFilters.supplierCity,
  }), [search, stockFilter, activeFilters]);

  const neededQuery = useNeededProducts(neededFilters, ready && activeTab === "besoins");

  const allRows = useMemo(
    () => neededQuery.data?.pages.flatMap((p) => p.rows) ?? [],
    [neededQuery.data],
  );
  const firstPage = neededQuery.data?.pages[0];
  const ruptureTotal = firstPage?.ruptureTotal ?? 0;
  const lowTotal     = firstPage?.lowTotal     ?? 0;

  // ── Idées state ──
  const suggestionsQuery = usePurchaseSuggestions(ready && activeTab === "idees");
  const suggestions      = suggestionsQuery.data ?? [];

  const deleteSuggestion = useDeleteSuggestion();
  const tapSuggestion    = useTapSuggestion();

  const [tappingId, setTappingId] = useState<number | null>(null);

  // ── PO creation ──
  const createPO = useCreatePurchaseOrder();

  if (!ready) return null;

  // ── Besoins helpers ──
  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function startBuilding() {
    const chosen = allRows.filter((r) => selected.has(r.id));
    const lines: PurchaseOrderLine[] = chosen.map((r) => ({
      product: neededRowToProduct(r),
      quantity: String(Math.max((r.min_stock ?? 0) - r.stock, 1)),
      unitCost: r.cost_price ?? "",
    }));
    setValues({ ...emptyPurchaseOrderForm(), lines });
    setBuilding(true);
  }

  function handleSubmitPO() {
    if (!values.supplier) return;
    createPO.mutate(
      {
        data: {
          supplierId: values.supplier.id,
          notes: values.notes.trim() || undefined,
          paymentMethod: values.paymentMethod,
          items: values.lines.map((l) => ({
            productId: l.product.id,
            quantity: Number(l.quantity),
            unitCost: Number(l.unitCost),
          })),
        } as never,
      },
      {
        onSuccess: () => {
          feedback.success(t("Bon d'achat créé", "تم إنشاء أمر الشراء"), t("Bon d'achat créé", "تم إنشاء أمر الشراء"));
          queryClient.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: ["purchases-needed"] });
          setSelected(new Set());
          setBuilding(false);
          setValues(emptyPurchaseOrderForm());
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  // ── Active filter count badge ──
  const filterCount =
    (activeFilters.familyId ? 1 : 0) +
    (activeFilters.brandId  ? 1 : 0) +
    (activeFilters.supplierCity ? 1 : 0) +
    (activeFilters.sortBy !== "profit" ? 1 : 0);

  // ── PO builder view ──
  if (building) {
    return (
      <Screen>
        <Button
          label={t("← Retour à la sélection", "← الرجوع للاختيار")}
          variant="ghost"
          onPress={() => setBuilding(false)}
        />
        <PurchaseOrderForm
          values={values}
          onChange={setValues}
          onSubmit={handleSubmitPO}
          submitting={createPO.isPending}
          submitLabel={t("Créer le bon d'achat", "إنشاء أمر الشراء")}
        />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TabBar active={activeTab} onChange={(tab) => { setActiveTab(tab); setSelected(new Set()); }} />

      {/* ── BESOINS TAB ── */}
      {activeTab === "besoins" ? (
        <View style={{ flex: 1 }}>
          {/* Search + filter row */}
          <View style={styles.searchRow}>
            <View style={{ flex: 1 }}>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder={t("Rechercher un produit...", "بحث عن منتج...")}
              />
            </View>
            <Pressable
              onPress={() => setFilterOpen(true)}
              style={[styles.filterBtn, filterCount > 0 && styles.filterBtnActive]}
            >
              <Feather name="filter" size={18} color={filterCount > 0 ? "#fff" : colors.primary} />
              {filterCount > 0 ? (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{filterCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          {/* Stock filter pills */}
          <StockPills value={stockFilter} onChange={setStockFilter} ruptureTotal={ruptureTotal} lowTotal={lowTotal} />

          {/* Product list */}
          {neededQuery.isLoading && !neededQuery.data ? (
            <LoadingView />
          ) : (
            <FlatList
              data={allRows}
              keyExtractor={(r: NeededRow) => String(r.id)}
              renderItem={({ item: r }) => (
                <Pressable style={styles.row} onPress={() => toggle(r.id)} testID={`row-needed-${r.id}`}>
                  <View style={[styles.checkbox, selected.has(r.id) && styles.checkboxChecked]}>
                    {selected.has(r.id) ? <Feather name="check" size={14} color="#fff" /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {lang === "ar" ? r.designation_ar : r.designation}
                    </Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {[r.reference, r.famille ?? r.marque, r.supplier_name].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Badge label={String(r.stock)} tone={r.stock === 0 ? "danger" : "warning"} />
                </Pressable>
              )}
              ListEmptyComponent={
                <EmptyState
                  title={t("Aucun produit à réapprovisionner", "لا توجد منتجات تحتاج إعادة تزويد")}
                  subtitle={search || filterCount > 0 ? t("Essayez d'autres filtres", "جرب فلاتر أخرى") : undefined}
                />
              }
              onEndReached={() => {
                if (neededQuery.hasNextPage && !neededQuery.isFetchingNextPage) {
                  neededQuery.fetchNextPage();
                }
              }}
              onEndReachedThreshold={0.4}
              contentContainerStyle={{ paddingBottom: selected.size > 0 ? 96 : 40 }}
              refreshing={neededQuery.isRefetching}
              onRefresh={() => neededQuery.refetch()}
            />
          )}

          {/* Selection footer */}
          {selected.size > 0 ? (
            <View style={styles.footer}>
              <Button
                label={t(`Construire le bon (${selected.size})`, `إنشاء أمر شراء (${selected.size})`)}
                onPress={startBuilding}
                testID="button-build-purchase-order"
              />
            </View>
          ) : null}

          <FilterModal
            visible={filterOpen}
            onClose={() => setFilterOpen(false)}
            filters={activeFilters}
            onApply={setActiveFilters}
            enabled={ready}
          />
        </View>
      ) : null}

      {/* ── IDÉES TAB ── */}
      {activeTab === "idees" ? (
        <View style={{ flex: 1 }}>
          {suggestionsQuery.isLoading ? (
            <LoadingView />
          ) : (
            <FlatList
              data={suggestions}
              keyExtractor={(s: PurchaseSuggestion) => String(s.id)}
              renderItem={({ item }) => (
                <SuggestionCard
                  item={item}
                  isOwner={item.staff_id === (user as { id?: number } | null)?.id}
                  isAdmin={!!isAdmin}
                  onEdit={() =>
                    router.push({
                      pathname: "/(app)/smart-purchase/suggestion-form",
                      params: {
                        id: String(item.id),
                        product_name: item.product_name,
                        market_price: item.market_price ?? "",
                        notes: item.notes ?? "",
                      },
                    })
                  }
                  onDelete={() =>
                    confirm({
                      title: t("Supprimer l'idée ?", "حذف الاقتراح؟"),
                      message: t(
                        `Supprimer "${item.product_name}" ?`,
                        `حذف "${item.product_name}"؟`,
                      ),
                      confirmLabel: t("Supprimer", "حذف"),
                      destructive: true,
                    }).then((ok) => {
                      if (ok) {
                        deleteSuggestion.mutate(item.id, {
                          onError: (e) => feedback.error(e),
                        });
                      }
                    })
                  }
                  onTap={() => {
                    setTappingId(item.id);
                    tapSuggestion.mutate(item.id, {
                      onSettled: () => setTappingId(null),
                      onError: (e) => feedback.error(e),
                    });
                  }}
                  tapping={tappingId === item.id}
                />
              )}
              ListEmptyComponent={
                <EmptyState
                  title={t("Aucune idée pour l'instant", "لا توجد اقتراحات بعد")}
                  subtitle={t("Ajoutez la première via le bouton +", "أضف الأول عبر زر +")}
                />
              }
              contentContainerStyle={{ paddingBottom: 96 }}
              refreshing={suggestionsQuery.isRefetching}
              onRefresh={() => suggestionsQuery.refetch()}
            />
          )}
          <Fab
            onPress={() => router.push("/(app)/smart-purchase/suggestion-form")}
            testID="fab-add-suggestion"
          />
        </View>
      ) : null}
    </View>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert NeededRow to a minimal Product shape compatible with PurchaseOrderForm. */
function neededRowToProduct(r: NeededRow): Product {
  return {
    id: r.id,
    nameEn: r.designation,
    nameAr: r.designation_ar,
    costPrice: r.cost_price,
    stock: r.stock,
    minStock: r.min_stock,
    reference: r.reference,
    // required but unused by the form
    price: r.price ?? "0",
    isActive: true,
  } as unknown as Product;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Tab bar
  tabBar: { flexDirection: "row", backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabItemActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { fontSize: 14, fontWeight: "500", color: colors.textMuted },
  tabTextActive: { color: colors.primary, fontWeight: "700" },

  // Stock pills
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 16, marginBottom: 8 },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 13, color: colors.text, fontWeight: "500" },
  pillTextActive: { color: "#fff" },

  // Search row
  searchRow: { flexDirection: "row", alignItems: "center", paddingRight: 16, gap: 8 },
  filterBtn: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterBadge: { position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  filterBadgeText: { fontSize: 9, color: "#fff", fontWeight: "700" },

  // Product rows
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  name: { fontSize: 14, fontWeight: "600", color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },

  // Filter modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", flex: 0 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  modalFooter: { flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.border },
  filterLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },

  // Suggestion cards
  suggestionCard: { backgroundColor: colors.surface, marginHorizontal: 12, marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  suggestionImg: { width: "100%", height: 120 },
  suggestionBody: { padding: 12, gap: 4 },
  suggestionRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  suggestionName: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  suggestionActions: { flexDirection: "row", gap: 14 },
  suggestionPrice: { fontSize: 13, color: colors.success, fontWeight: "600" },
  suggestionNotes: { fontSize: 13, color: colors.textMuted },
  suggestionMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  suggestionAuthor: { fontSize: 12, color: colors.textMuted },
  tapBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: colors.primary },
  tapCount: { fontSize: 12, color: colors.primary, fontWeight: "600" },
});
