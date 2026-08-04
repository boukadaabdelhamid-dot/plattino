/**
 * Besoin d'achat (Smart Purchase) — مطابق 100% للـ ERP
 *
 * 4 tabs: Tout · En rupture · Stock faible · Idées
 * Per-product: image, StockBar, inline min-stock, metric, suggested qty,
 *              supplier info + Historique · Commander · Acheté · Exclure
 */
import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, Pressable, Modal, ScrollView,
  FlatList, Image, TextInput, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useConfirm } from "@/contexts/confirm-context";
import { useMe } from "@/hooks/use-me";
import { SearchBar } from "@/components/ListScreen";
import { Button, LoadingView, EmptyState } from "@/components/ui";
import { Fab } from "@/components/Fab";
import { colors } from "@/lib/colors";
import {
  useNeededProducts, useFilterOptions, usePurchaseHistory,
  useSnoozeProduct, useExcludeProduct, usePatchProductMinStock,
  useDraftPOs, useQuickOrder, useAddToPO, useSuppliersAll,
  usePurchaseSuggestions, useDeleteSuggestion, useTapSuggestion,
  type NeededRow, type NeededFilters, type DraftPO, type PurchaseSuggestion,
} from "@/hooks/use-smart-purchase";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number | string | null | undefined): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  return isNaN(v) ? "—" : v.toLocaleString("fr-DZ", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type DatePreset = "month" | "30d" | "3m" | "year";
function getDateRange(preset: DatePreset) {
  const today = new Date();
  const to = localDateStr(today);
  switch (preset) {
    case "month": return { from: localDateStr(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    case "30d":   return { from: localDateStr(new Date(today.getTime() - 30 * 86_400_000)), to };
    case "3m":    return { from: localDateStr(new Date(today.getTime() - 90 * 86_400_000)), to };
    case "year":  return { from: `${today.getFullYear()}-01-01`, to };
  }
}

// ─── StockBar ─────────────────────────────────────────────────────────────────

function StockBar({ stock, minStock }: { stock: number; minStock: number | null }) {
  const isRupture = stock === 0;
  if (minStock == null || minStock <= 0) {
    return (
      <View style={sb.row}>
        <Text style={[sb.qty, isRupture && sb.red]}>{stock}</Text>
        {isRupture && <View style={sb.badge}><Text style={sb.badgeText}>RUPTURE</Text></View>}
      </View>
    );
  }
  const pct = Math.min(100, Math.round((stock / minStock) * 100));
  const barColor = pct === 0 ? colors.danger : pct < 50 ? colors.warning : colors.success;
  return (
    <View>
      <View style={sb.row}>
        <Text style={[sb.qty, isRupture && sb.red]}>{stock}</Text>
        <Text style={sb.slash}>/ {minStock}</Text>
      </View>
      <View style={sb.track}>
        <View style={[sb.fill, { width: `${pct}%` as `${number}%`, backgroundColor: barColor }]} />
      </View>
    </View>
  );
}

const sb = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 3 },
  qty: { fontSize: 15, fontWeight: "700", color: colors.warning },
  red: { color: colors.danger },
  slash: { fontSize: 11, color: colors.textMuted },
  track: { height: 4, backgroundColor: colors.border, borderRadius: 4, marginTop: 3, overflow: "hidden" },
  fill: { height: 4, borderRadius: 4 },
  badge: { backgroundColor: "#fee2e2", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  badgeText: { fontSize: 9, fontWeight: "700", color: colors.danger },
});

// ─── InlineMinStock ───────────────────────────────────────────────────────────

function InlineMinStock({ productId, minStock }: { productId: number; minStock: number | null }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const patchMinStock = usePatchProductMinStock();

  function startEdit() {
    setValue(minStock != null ? String(minStock) : "");
    setEditing(true);
  }

  function save() {
    if (!editing) return;
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
    if (parsed !== null && (isNaN(parsed) || parsed < 0)) { setEditing(false); return; }
    setEditing(false);
    if (parsed === minStock) return;
    patchMinStock.mutate({ productId, minStock: parsed });
  }

  if (editing) {
    return (
      <TextInput
        autoFocus
        keyboardType="number-pad"
        value={value}
        onChangeText={setValue}
        onBlur={save}
        onSubmitEditing={save}
        style={ms.input}
        selectTextOnFocus
      />
    );
  }

  return (
    <Pressable onPress={startEdit} style={ms.row} hitSlop={8}>
      <Text style={ms.value}>
        {minStock != null ? fmtNum(minStock) : t("— Définir", "— تحديد")}
      </Text>
      <Feather name="edit-2" size={9} color={colors.textMuted} />
    </Pressable>
  );
}

const ms = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 3 },
  value: { fontSize: 11, color: colors.textMuted },
  input: {
    width: 52, height: 22, fontSize: 11, borderWidth: 1, borderColor: colors.primary,
    borderRadius: 4, paddingHorizontal: 4, color: colors.text,
  },
});

// ─── HistorySheet ─────────────────────────────────────────────────────────────

function HistorySheet({ product, onClose }: { product: NeededRow | null; onClose: () => void }) {
  const { t } = useLang();
  const { data, isLoading } = usePurchaseHistory(product?.id ?? null, product != null);

  return (
    <Modal visible={product != null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sh.overlay}>
        <View style={sh.sheet}>
          <View style={sh.header}>
            <View style={{ flex: 1 }}>
              <Text style={sh.title}>
                <Feather name="clock" size={15} /> {t("Historique d'achat", "تاريخ الشراء")}
              </Text>
              {product && <Text style={sh.subtitle} numberOfLines={1}>{product.designation}</Text>}
            </View>
            <Pressable onPress={onClose} hitSlop={12}><Feather name="x" size={22} color={colors.text} /></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 10 }}>
            {/* Product image */}
            {product?.image_url ? (
              <View style={{ alignItems: "center", marginBottom: 8 }}>
                <Image source={{ uri: product.image_url }} style={sh.productImg} resizeMode="cover" />
              </View>
            ) : null}

            {isLoading && <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />}

            {!isLoading && (!data || data.length === 0) && (
              <EmptyState title={t("Aucun historique d'achat", "لا يوجد تاريخ شراء")} />
            )}

            {data?.map((row, i) => (
              <View key={`${row.po_id}-${i}`} style={sh.histCard}>
                <View style={sh.histTop}>
                  <Text style={sh.histDate}>
                    {new Date(row.received_date).toLocaleDateString("fr-DZ")}
                  </Text>
                  <Text style={sh.histRef}>#{String(row.po_id).padStart(6, "0")}</Text>
                </View>
                <Text style={sh.histSupplier}>{row.supplier_name}</Text>
                {row.supplier_address ? (
                  <View style={sh.histRow}>
                    <Feather name="map-pin" size={11} color={colors.textMuted} />
                    <Text style={sh.histMeta} numberOfLines={1}>{row.supplier_address}</Text>
                  </View>
                ) : null}
                {row.supplier_phone ? (
                  <View style={sh.histRow}>
                    <Feather name="phone" size={11} color={colors.textMuted} />
                    <Text style={sh.histMeta}>{row.supplier_phone}</Text>
                  </View>
                ) : null}
                <View style={sh.histBottom}>
                  <Text style={sh.histQty}>{t("Qté", "الكمية")}: {fmtNum(row.quantity)}</Text>
                  <Text style={sh.histPrice}>{fmtNum(row.unit_cost)} DA</Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const sh = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%" },
  header: { flexDirection: "row", alignItems: "flex-start", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  productImg: { width: 96, height: 96, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  histCard: { backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 3 },
  histTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  histDate: { fontSize: 12, fontWeight: "600", color: colors.textMuted },
  histRef: { fontSize: 10, color: colors.textMuted, fontFamily: "monospace" },
  histSupplier: { fontSize: 13, fontWeight: "600", color: colors.text },
  histRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  histMeta: { fontSize: 11, color: colors.textMuted, flex: 1 },
  histBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border },
  histQty: { fontSize: 12, color: colors.textMuted },
  histPrice: { fontSize: 14, fontWeight: "700", color: "#059669" },
});

// ─── QuickOrderSheet ──────────────────────────────────────────────────────────

function QuickOrderSheet({
  product, onClose, onOrdered,
}: {
  product: NeededRow | null;
  onClose: () => void;
  onOrdered: (productId: number) => void;
}) {
  const { t } = useLang();
  const feedback = useApiFeedback();

  const [mode, setMode]             = useState<"new" | "existing">("new");
  const [supplierId, setSupplierId] = useState("");
  const [selectedPoId, setSelectedPoId] = useState("");
  const [quantity, setQuantity]     = useState("1");
  const [unitCost, setUnitCost]     = useState("");
  const [payment, setPayment]       = useState<"comptant" | "a_terme">("comptant");
  const [error, setError]           = useState("");
  const [success, setSuccess]       = useState<{ id: number; itemCount: number; merged?: boolean } | null>(null);
  const priceEdited = useRef(false);

  const open = product != null;

  const { data: suppliers = [] } = useSuppliersAll(open);

  const { data: draftPOs = [] } = useDraftPOs(open);
  const { data: history } = usePurchaseHistory(product?.id ?? null, open);
  const lastUnitCost = history?.[0]?.unit_cost ?? null;

  const quickOrder = useQuickOrder();
  const addToPO    = useAddToPO();

  // Reset when product changes
  useEffect(() => {
    if (!product) return;
    priceEdited.current = false;
    setSupplierId(product.supplier_id ? String(product.supplier_id) : "");
    setQuantity(String(Math.max(1, (product.min_stock ?? 0) - product.stock)));
    setUnitCost(product.cost_price ? String(Number(product.cost_price).toFixed(2)) : "");
    setSuccess(null);
    setError("");
    setMode("new");
    setSelectedPoId("");
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply last real purchase price from history once loaded
  useEffect(() => {
    if (lastUnitCost == null || priceEdited.current || success != null) return;
    setUnitCost(Number(lastUnitCost).toFixed(2));
  }, [lastUnitCost, success]);

  const sortedDrafts = useMemo(() => {
    const preferred = product?.supplier_id ?? null;
    return [...draftPOs].sort((a, b) => (a.supplierId === preferred ? 0 : 1) - (b.supplierId === preferred ? 0 : 1));
  }, [draftPOs, product?.supplier_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const minQty = product
    ? Math.max(1, (product.min_stock ?? 0) - product.stock)
    : 1;

  function handleSubmit() {
    if (!product) return;
    const qty = parseInt(quantity, 10);
    const cost = parseFloat(unitCost);
    if (!qty || qty <= 0) { setError(t("Quantité invalide", "كمية غير صحيحة")); return; }
    if (isNaN(cost) || cost <= 0) { setError(t("Prix d'achat invalide", "سعر الشراء غير صحيح")); return; }
    setError("");

    if (mode === "new") {
      const sid = parseInt(supplierId, 10);
      if (!supplierId || isNaN(sid)) { setError(t("Sélectionnez un fournisseur", "اختر موردًا")); return; }
      quickOrder.mutate(
        { supplierId: sid, items: [{ productId: product.id, quantity: qty, unitCost: cost }], paymentMethod: payment },
        {
          onSuccess: (res) => { setSuccess({ id: (res as { id: number }).id, itemCount: 1 }); onOrdered(product.id); },
          onError: (e) => setError(e instanceof Error ? e.message : t("Erreur inattendue", "خطأ غير متوقع")),
        },
      );
    } else {
      const poId = parseInt(selectedPoId, 10);
      if (!selectedPoId || isNaN(poId)) { setError(t("Sélectionnez un bon existant", "اختر بوناً")); return; }
      const po = draftPOs.find((p) => p.id === poId);
      if (!po) { setError(t("Bon introuvable", "البون غير موجود")); return; }
      addToPO.mutate(
        {
          poId,
          po: { supplierId: po.supplierId ?? 0, paymentMethod: po.paymentMethod, notes: po.notes },
          newItem: { productId: product.id, quantity: qty, unitCost: cost },
        },
        {
          onSuccess: (res) => { setSuccess(res as { id: number; itemCount: number; merged?: boolean }); onOrdered(product.id); },
          onError: (e) => setError(e instanceof Error ? e.message : t("Erreur inattendue", "خطأ غير متوقع")),
        },
      );
    }
  }

  const submitting = quickOrder.isPending || addToPO.isPending;
  const productName = product ? product.designation : "";

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={qo.overlay}>
        <View style={qo.sheet}>
          <View style={qo.header}>
            <View style={{ flex: 1 }}>
              <Text style={qo.title}>
                <Feather name="shopping-cart" size={15} /> {t("Bon de commande", "بون شراء")}
              </Text>
              <Text style={qo.subtitle} numberOfLines={1}>{productName}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12}><Feather name="x" size={22} color={colors.text} /></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }} keyboardShouldPersistTaps="handled">
            {success ? (
              /* ── Success ── */
              <View style={qo.successBox}>
                <View style={qo.successIcon}>
                  <Feather name="check-circle" size={28} color="#059669" />
                </View>
                <Text style={qo.successTitle}>
                  {mode === "new"
                    ? t("Bon créé avec succès !", "تم إنشاء البون بنجاح!")
                    : success.merged
                      ? t("Quantité mise à jour !", "تم تحديث الكمية!")
                      : t("Produit ajouté avec succès !", "تمت إضافة المنتج بنجاح!")}
                </Text>
                <Text style={qo.successRef}>
                  #{String(success.id).padStart(6, "0")} · {success.itemCount} {t("article(s)", "صنف")}
                </Text>
                <Button label={t("Fermer", "إغلاق")} variant="secondary" onPress={onClose} style={{ marginTop: 8 }} />
              </View>
            ) : (
              <>
                {/* Mode toggle */}
                <View style={qo.modeRow}>
                  {(["new", "existing"] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => { setMode(m); setSelectedPoId(""); setError(""); }}
                      disabled={m === "existing" && sortedDrafts.length === 0}
                      style={[qo.modeBtn, mode === m && qo.modeBtnActive, m === "existing" && sortedDrafts.length === 0 && qo.modeBtnDisabled]}
                    >
                      <Text style={[qo.modeTxt, mode === m && qo.modeTxtActive]}>
                        {m === "new" ? t("Nouveau bon", "بون جديد") : `${t("Bon existant", "بون موجود")} (${sortedDrafts.length})`}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Supplier / Draft PO */}
                {mode === "new" ? (
                  <View>
                    <Text style={qo.label}>{t("Fournisseur *", "المورد *")}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                      {suppliers.map((s) => (
                        <Pressable key={s.id}
                          onPress={() => setSupplierId(String(s.id))}
                          style={[qo.supplierPill, supplierId === String(s.id) && qo.supplierPillActive]}>
                          <Text style={[qo.supplierPillTxt, supplierId === String(s.id) && qo.supplierPillTxtActive]}
                            numberOfLines={1}>
                            {supplierId === String(s.id) && <Feather name="check" size={11} />} {s.name}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                ) : (
                  <View>
                    <Text style={qo.label}>{t("Bon de commande *", "بون الشراء *")}</Text>
                    <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 160 }}>
                      {sortedDrafts.map((po) => {
                        const sup = suppliers.find((s) => s.id === po.supplierId);
                        const isPreferred = po.supplierId === product?.supplier_id;
                        return (
                          <Pressable key={po.id}
                            onPress={() => setSelectedPoId(String(po.id))}
                            style={[qo.draftRow, selectedPoId === String(po.id) && qo.draftRowActive]}>
                            <Text style={qo.draftRef}>
                              {isPreferred ? "★ " : ""}#{String(po.id).padStart(6, "0")}
                            </Text>
                            <Text style={qo.draftSup} numberOfLines={1}>{sup?.name ?? "—"}</Text>
                            <Text style={qo.draftTotal}>{fmtNum(po.totalAmount)} DA</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                {/* Quantity */}
                <View>
                  <Text style={qo.label}>{t("Quantité *", "الكمية *")}</Text>
                  <View style={qo.qtyRow}>
                    <Pressable
                      onPress={() => setQuantity(String(minQty))}
                      style={[qo.qtyBtn, quantity === String(minQty) && qo.qtyBtnActive]}>
                      <Text style={[qo.qtyBtnTxt, quantity === String(minQty) && qo.qtyBtnTxtActive]}>
                        {t("Min stock", "الحد الأدنى")} ({minQty})
                      </Text>
                    </Pressable>
                  </View>
                  <TextInput
                    style={qo.input}
                    keyboardType="number-pad"
                    value={quantity}
                    onChangeText={setQuantity}
                    placeholder="1"
                  />
                </View>

                {/* Unit cost */}
                <View>
                  <Text style={qo.label}>{t("Prix d'achat unitaire (DA) *", "سعر الشراء الوحدوي (دج) *")}</Text>
                  <TextInput
                    style={qo.input}
                    keyboardType="decimal-pad"
                    value={unitCost}
                    onChangeText={(v) => { priceEdited.current = true; setUnitCost(v); }}
                    placeholder="0.00"
                  />
                  {lastUnitCost != null ? (
                    <Text style={qo.hint}>
                      {t("Dernier prix:", "آخر سعر:")} {fmtNum(lastUnitCost)} DA
                    </Text>
                  ) : null}
                </View>

                {/* Payment (new only) */}
                {mode === "new" ? (
                  <View>
                    <Text style={qo.label}>{t("Mode de paiement", "طريقة الدفع")}</Text>
                    <View style={qo.modeRow}>
                      {(["comptant", "a_terme"] as const).map((m) => (
                        <Pressable key={m} onPress={() => setPayment(m)}
                          style={[qo.modeBtn, payment === m && (m === "comptant" ? qo.modeBtnGreen : qo.modeBtnActive)]}>
                          <Text style={[qo.modeTxt, payment === m && qo.modeTxtActive]}>
                            {m === "comptant" ? t("Comptant", "نقداً") : t("À terme", "آجل")}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}

                {error ? <Text style={qo.error}>{error}</Text> : null}

                <Button
                  label={submitting
                    ? (mode === "new" ? t("Création…", "جارٍ الإنشاء…") : t("Ajout…", "جارٍ الإضافة…"))
                    : (mode === "new" ? t("Créer le bon", "إنشاء البون") : t("Ajouter au bon", "إضافة للبون"))}
                  onPress={handleSubmit}
                  loading={submitting}
                  testID="button-submit-quick-order"
                />
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const qo = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%" },
  header: { flexDirection: "row", alignItems: "flex-start", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 15, fontWeight: "700", color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  label: { fontSize: 13, fontWeight: "600", color: colors.text, marginBottom: 6 },
  input: { height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, color: colors.text, backgroundColor: colors.background },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  error: { fontSize: 13, color: colors.danger, backgroundColor: "#fef2f2", padding: 10, borderRadius: 10 },
  modeRow: { flexDirection: "row", borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  modeBtn: { flex: 1, paddingVertical: 12, alignItems: "center", backgroundColor: colors.surface },
  modeBtnActive: { backgroundColor: colors.primary },
  modeBtnGreen: { backgroundColor: "#059669" },
  modeBtnDisabled: { opacity: 0.4 },
  modeTxt: { fontSize: 13, fontWeight: "600", color: colors.text },
  modeTxtActive: { color: "#fff" },
  supplierPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  supplierPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  supplierPillTxt: { fontSize: 13, color: colors.text, maxWidth: 120 },
  supplierPillTxtActive: { color: "#fff" },
  draftRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 6, backgroundColor: colors.background },
  draftRowActive: { borderColor: colors.primary, backgroundColor: "#eff6ff" },
  draftRef: { fontSize: 12, fontFamily: "monospace", color: colors.textMuted, width: 70 },
  draftSup: { flex: 1, fontSize: 12, color: colors.text, fontWeight: "500" },
  draftTotal: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  qtyRow: { flexDirection: "row", marginBottom: 8 },
  qtyBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  qtyBtnActive: { backgroundColor: "#1e293b", borderColor: "#1e293b" },
  qtyBtnTxt: { fontSize: 12, fontWeight: "600", color: colors.text },
  qtyBtnTxtActive: { color: "#fff" },
  successBox: { alignItems: "center", paddingVertical: 32, gap: 8 },
  successIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#d1fae5", alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center" },
  successRef: { fontSize: 12, color: colors.textMuted, fontFamily: "monospace" },
});

// ─── Filter modal ─────────────────────────────────────────────────────────────

type ActiveFilters = {
  supplierId: number | null;
  supplierName: string | null;
  familyId: number | null;
  familyName: string | null;
  brandId: number | null;
  brandName: string | null;
  supplierCity: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  datePreset: DatePreset | null;
};

const DEFAULT_FILTERS: ActiveFilters = {
  supplierId: null, supplierName: null,
  familyId: null,   familyName: null,
  brandId: null,    brandName: null,
  supplierCity: null,
  dateFrom: null, dateTo: null, datePreset: null,
};

function FilterModal({
  visible, onClose, filters, onApply, enabled, suppliers,
}: {
  visible: boolean; onClose: () => void;
  filters: ActiveFilters; onApply: (f: ActiveFilters) => void; enabled: boolean;
  suppliers: { id: number; name: string }[];
}) {
  const { t, lang } = useLang();
  const [local, setLocal] = useState<ActiveFilters>(filters);
  const { data: opts } = useFilterOptions(enabled);

  useEffect(() => { if (visible) setLocal(filters); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyDatePreset(preset: DatePreset) {
    const { from, to } = getDateRange(preset);
    setLocal((p) => ({ ...p, datePreset: preset, dateFrom: from, dateTo: to }));
  }

  function reset() { setLocal(DEFAULT_FILTERS); }
  function apply() { onApply(local); onClose(); }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={fm.overlay}>
        <View style={fm.sheet}>
          <View style={fm.header}>
            <Text style={fm.title}>{t("Filtres", "الفلاتر")}</Text>
            <Pressable onPress={onClose} hitSlop={12}><Feather name="x" size={22} color={colors.text} /></Pressable>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 24 }}>

            {/* Supplier — only suppliers from current product list (small set, no freeze) */}
            {suppliers.length > 0 ? (
              <>
                <Text style={fm.sectionLabel}>{t("Fournisseur", "المورد")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Pressable onPress={() => setLocal((p) => ({ ...p, supplierId: null, supplierName: null }))}
                    style={[fm.pill, !local.supplierId && fm.pillOn]}>
                    <Text style={[fm.pillTxt, !local.supplierId && fm.pillTxtOn]}>{t("Tout", "الكل")}</Text>
                  </Pressable>
                  {suppliers.map((s) => (
                    <Pressable key={s.id} onPress={() => setLocal((p) => ({ ...p, supplierId: s.id, supplierName: s.name }))}
                      style={[fm.pill, local.supplierId === s.id && fm.pillOn]}>
                      <Text style={[fm.pillTxt, local.supplierId === s.id && fm.pillTxtOn]} numberOfLines={1}>{s.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {/* Family */}
            {opts?.families?.length ? (
              <>
                <Text style={fm.sectionLabel}>{t("Famille", "العائلة")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Pressable onPress={() => setLocal((p) => ({ ...p, familyId: null, familyName: null }))}
                    style={[fm.pill, !local.familyId && fm.pillOn]}>
                    <Text style={[fm.pillTxt, !local.familyId && fm.pillTxtOn]}>{t("Tout", "الكل")}</Text>
                  </Pressable>
                  {opts.families.map((f) => (
                    <Pressable key={f.id} onPress={() => setLocal((p) => ({ ...p, familyId: f.id, familyName: lang === "ar" ? f.nameAr : f.nameFr }))}
                      style={[fm.pill, local.familyId === f.id && fm.pillOn]}>
                      <Text style={[fm.pillTxt, local.familyId === f.id && fm.pillTxtOn]}>{lang === "ar" ? f.nameAr : f.nameFr}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {/* Brand */}
            {opts?.brands?.length ? (
              <>
                <Text style={fm.sectionLabel}>{t("Marque", "الماركة")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Pressable onPress={() => setLocal((p) => ({ ...p, brandId: null, brandName: null }))}
                    style={[fm.pill, !local.brandId && fm.pillOn]}>
                    <Text style={[fm.pillTxt, !local.brandId && fm.pillTxtOn]}>{t("Tout", "الكل")}</Text>
                  </Pressable>
                  {opts.brands.map((b) => (
                    <Pressable key={b.id} onPress={() => setLocal((p) => ({ ...p, brandId: b.id, brandName: lang === "ar" ? b.nameAr : b.nameFr }))}
                      style={[fm.pill, local.brandId === b.id && fm.pillOn]}>
                      <Text style={[fm.pillTxt, local.brandId === b.id && fm.pillTxtOn]}>{lang === "ar" ? b.nameAr : b.nameFr}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {/* Supplier city */}
            {opts?.supplierCities?.length ? (
              <>
                <Text style={fm.sectionLabel}>{t("Ville fournisseur", "مدينة المورد")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  <Pressable onPress={() => setLocal((p) => ({ ...p, supplierCity: null }))}
                    style={[fm.pill, !local.supplierCity && fm.pillOn]}>
                    <Text style={[fm.pillTxt, !local.supplierCity && fm.pillTxtOn]}>{t("Tout", "الكل")}</Text>
                  </Pressable>
                  {opts.supplierCities.map((c) => (
                    <Pressable key={c} onPress={() => setLocal((p) => ({ ...p, supplierCity: c }))}
                      style={[fm.pill, local.supplierCity === c && fm.pillOn]}>
                      <Text style={[fm.pillTxt, local.supplierCity === c && fm.pillTxtOn]}>{c}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {/* Date range */}
            <Text style={fm.sectionLabel}>{t("Période des ventes", "فترة المبيعات")}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {([
                { key: "month", fr: "Ce mois", ar: "هذا الشهر" },
                { key: "30d",   fr: "30 jours", ar: "30 يوماً" },
                { key: "3m",    fr: "3 mois",  ar: "3 أشهر" },
                { key: "year",  fr: "Cette année", ar: "هذه السنة" },
              ] as { key: DatePreset; fr: string; ar: string }[]).map(({ key, fr, ar }) => (
                <Pressable key={key} onPress={() => applyDatePreset(key)}
                  style={[fm.pill, local.datePreset === key && fm.pillOn]}>
                  <Text style={[fm.pillTxt, local.datePreset === key && fm.pillTxtOn]}>{lang === "ar" ? ar : fr}</Text>
                </Pressable>
              ))}
              {local.datePreset ? (
                <Pressable onPress={() => setLocal((p) => ({ ...p, datePreset: null, dateFrom: null, dateTo: null }))}
                  style={fm.pill}>
                  <Text style={fm.pillTxt}>{t("Effacer", "مسح")}</Text>
                </Pressable>
              ) : null}
            </View>
            {local.dateFrom && local.dateTo ? (
              <Text style={fm.dateHint}>{local.dateFrom} → {local.dateTo}</Text>
            ) : null}
          </ScrollView>

          <View style={fm.footer}>
            <Button label={t("Réinitialiser", "إعادة تعيين")} variant="ghost" onPress={reset} style={{ flex: 1 }} />
            <Button label={t("Appliquer", "تطبيق")} onPress={apply} style={{ flex: 2 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const fm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%", flex: 0 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  footer: { flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: colors.border },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillTxt: { fontSize: 13, color: colors.text, fontWeight: "500" },
  pillTxtOn: { color: "#fff" },
  dateHint: { fontSize: 11, color: colors.textMuted },
});

// ─── ProductCard ──────────────────────────────────────────────────────────────

function ProductCard({
  row, sortBy, onHistory, onOrder, onSnooze, onExclude,
}: {
  row: NeededRow;
  sortBy: "profit" | "qty_sold";
  onHistory: () => void;
  onOrder: () => void;
  onSnooze: () => void;
  onExclude: () => void;
}) {
  const { t, lang } = useLang();
  const name = lang === "ar" && row.designation_ar ? row.designation_ar : row.designation;
  const suggestedQty = row.min_stock != null ? Math.max(1, row.min_stock - row.stock) : null;

  return (
    <View style={pc.card}>
      {/* Header row: image + name/meta */}
      <View style={pc.top}>
        {row.image_url ? (
          <Image source={{ uri: row.image_url }} style={pc.img} resizeMode="cover" />
        ) : (
          <View style={[pc.img, pc.imgFallback]}>
            <Feather name="package" size={24} color={colors.textMuted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={pc.name} numberOfLines={2}>{name}</Text>
          <Text style={pc.meta} numberOfLines={1}>
            {[row.reference, row.famille ?? row.marque].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>

      {/* Stock + min */}
      <View style={pc.statsRow}>
        <View style={{ flex: 1 }}>
          <Text style={pc.statLabel}>{t("Stock", "المخزون")}</Text>
          <StockBar stock={row.stock} minStock={row.min_stock} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={pc.statLabel}>{t("Seuil min", "الحد الأدنى")}</Text>
          <InlineMinStock productId={row.id} minStock={row.min_stock} />
        </View>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={pc.statLabel}>{sortBy === "profit" ? t("Bénéfice", "الربح") : t("Qté vendue", "المباعة")}</Text>
          <Text style={pc.metric}>
            {sortBy === "profit"
              ? `${fmtNum(row.benefice)} DA`
              : `${fmtNum(row.total_qty_sold)} u.`}
          </Text>
        </View>
      </View>

      {/* Suggested qty */}
      {suggestedQty != null ? (
        <View style={pc.suggestRow}>
          <Feather name="shopping-cart" size={12} color={colors.primary} />
          <Text style={pc.suggestTxt}>
            {t("Qté à commander:", "الكمية المقترحة:")} <Text style={{ fontWeight: "700" }}>{suggestedQty}</Text>
          </Text>
        </View>
      ) : null}

      {/* Supplier */}
      {row.supplier_name ? (
        <View style={pc.supplierRow}>
          <Feather name="truck" size={11} color={colors.textMuted} />
          <Text style={pc.supplierTxt} numberOfLines={1}>
            {[row.supplier_name, row.supplier_city].filter(Boolean).join(" · ")}
          </Text>
          {row.supplier_phone ? (
            <Text style={pc.supplierPhone}>{row.supplier_phone}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Actions */}
      <View style={pc.actions}>
        <Pressable style={pc.actionBtn} onPress={onHistory} testID={`btn-history-${row.id}`}>
          <Feather name="clock" size={14} color={colors.text} />
          <Text style={pc.actionTxt}>{t("Historique", "التاريخ")}</Text>
        </Pressable>
        <Pressable style={[pc.actionBtn, pc.actionBtnPrimary]} onPress={onOrder} testID={`btn-order-${row.id}`}>
          <Feather name="shopping-cart" size={14} color="#fff" />
          <Text style={[pc.actionTxt, { color: "#fff" }]}>{t("Commander", "طلب")}</Text>
        </Pressable>
        <Pressable style={[pc.actionBtn, pc.actionBtnSuccess]} onPress={onSnooze} testID={`btn-snooze-${row.id}`}>
          <Feather name="check" size={14} color="#fff" />
          <Text style={[pc.actionTxt, { color: "#fff" }]}>{t("Acheté", "تم الشراء")}</Text>
        </Pressable>
        <Pressable style={pc.actionBtnSmall} onPress={onExclude} testID={`btn-exclude-${row.id}`} hitSlop={8}>
          <Feather name="x-circle" size={16} color={colors.danger} />
        </Pressable>
      </View>
    </View>
  );
}

const pc = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginHorizontal: 12, marginVertical: 5, padding: 12, gap: 8 },
  top: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  img: { width: 60, height: 60, borderRadius: 10 },
  imgFallback: { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 14, fontWeight: "700", color: colors.text },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border },
  statLabel: { fontSize: 10, color: colors.textMuted, fontWeight: "600", textTransform: "uppercase", marginBottom: 2 },
  metric: { fontSize: 12, fontWeight: "700", color: colors.primary },
  suggestRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  suggestTxt: { fontSize: 12, color: colors.text },
  supplierRow: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  supplierTxt: { fontSize: 11, color: "#1d4ed8", flex: 1 },
  supplierPhone: { fontSize: 11, color: colors.textMuted },
  actions: { flexDirection: "row", gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border, alignItems: "center" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  actionBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionBtnSuccess: { backgroundColor: "#059669", borderColor: "#059669" },
  actionBtnSmall: { padding: 6 },
  actionTxt: { fontSize: 11, fontWeight: "600", color: colors.text },
});

// ─── SuggestionCard ───────────────────────────────────────────────────────────

function SuggestionCard({
  item, isOwner, isAdmin: admin, onEdit, onDelete, onTap, onCommander, tapping,
}: {
  item: PurchaseSuggestion; isOwner: boolean; isAdmin: boolean;
  onEdit: () => void; onDelete: () => void;
  onTap: () => void; onCommander: () => void;
  tapping: boolean;
}) {
  const { t } = useLang();
  const date = new Date(item.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });

  return (
    <View style={sc.card}>
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={sc.img} resizeMode="cover" />
      ) : null}
      <View style={sc.body}>
        <View style={sc.titleRow}>
          <Text style={sc.name} numberOfLines={2}>{item.product_name}</Text>
          {(isOwner || admin) ? (
            <View style={sc.icons}>
              <Pressable onPress={onEdit} hitSlop={10} testID={`btn-edit-suggestion-${item.id}`}>
                <Feather name="edit-2" size={15} color={colors.primary} />
              </Pressable>
              <Pressable onPress={onDelete} hitSlop={10} testID={`btn-delete-suggestion-${item.id}`}>
                <Feather name="trash-2" size={15} color={colors.danger} />
              </Pressable>
            </View>
          ) : null}
        </View>
        {item.market_price ? (
          <Text style={sc.price}>{t("Prix marché:", "سعر السوق:")} {item.market_price} DA</Text>
        ) : null}
        {item.notes ? <Text style={sc.notes} numberOfLines={2}>{item.notes}</Text> : null}
        <View style={sc.footer}>
          <Text style={sc.author}>{item.staff_name ?? t("Employé", "موظف")} · {date}</Text>
          <View style={sc.footerActions}>
            <Pressable onPress={onTap} disabled={tapping} style={sc.tapBtn} testID={`btn-tap-${item.id}`}>
              <Feather name="thumbs-up" size={13} color={colors.primary} />
              <Text style={sc.tapCount}>{item.demand_count}</Text>
            </Pressable>
            <Pressable onPress={onCommander} style={sc.commanderBtn} testID={`btn-commander-suggestion-${item.id}`}>
              <Feather name="shopping-cart" size={13} color={colors.primary} />
              <Text style={sc.commanderTxt}>{t("Commander", "طلب")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const sc = StyleSheet.create({
  card: { backgroundColor: colors.surface, marginHorizontal: 12, marginVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  img: { width: "100%", height: 130 },
  body: { padding: 12, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.text },
  icons: { flexDirection: "row", gap: 12 },
  price: { fontSize: 13, color: "#059669", fontWeight: "600" },
  notes: { fontSize: 12, color: colors.textMuted },
  footer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  author: { fontSize: 11, color: colors.textMuted },
  footerActions: { flexDirection: "row", gap: 8 },
  tapBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: colors.primary },
  tapCount: { fontSize: 12, color: colors.primary, fontWeight: "600" },
  commanderBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: colors.primary },
  commanderTxt: { fontSize: 12, color: colors.primary, fontWeight: "600" },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

type TabKey = "all" | "rupture" | "low" | "idees";

export default function SmartPurchase() {
  const { ready, isAdmin } = useProtectedRoute({ section: "purchases" });
  const { t, lang } = useLang();
  const router = useRouter();
  const feedback = useApiFeedback();
  const { confirm } = useConfirm();
  const { user } = useMe();

  // ── Tab / filters ──
  const [activeTab, setActiveTab]     = useState<TabKey>("all");
  const [search, setSearch]           = useState("");
  const [sortBy, setSortBy]           = useState<"profit" | "qty_sold">("profit");
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen]   = useState(false);
  const [hiddenIds, setHiddenIds]     = useState<Set<number>>(new Set());

  // ── Sheets ──
  const [historyProduct, setHistoryProduct] = useState<NeededRow | null>(null);
  const [orderProduct, setOrderProduct]     = useState<NeededRow | null>(null);

  // ── Idées ──
  const [tappingId, setTappingId] = useState<number | null>(null);

  const isIdees = activeTab === "idees";

  const neededFilters: NeededFilters = useMemo(() => ({
    search:       search || undefined,
    stockFilter:  activeTab === "all" ? undefined : activeTab as "rupture" | "low",
    sortBy:       sortBy !== "profit" ? sortBy : undefined,
    supplierId:   activeFilters.supplierId,
    familyId:     activeFilters.familyId,
    brandId:      activeFilters.brandId,
    supplierCity: activeFilters.supplierCity,
    dateFrom:     activeFilters.dateFrom,
    dateTo:       activeFilters.dateTo,
  }), [search, activeTab, sortBy, activeFilters]);

  const neededQuery = useNeededProducts(neededFilters, ready && !isIdees);
  const allRows = useMemo(() => {
    const seen = new Set<number>();
    return (neededQuery.data?.pages.flatMap((p) => p.rows) ?? []).filter((r) => {
      if (hiddenIds.has(r.id) || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [neededQuery.data, hiddenIds]);
  const firstPage = neededQuery.data?.pages[0];
  const ruptureTotal = firstPage?.ruptureTotal ?? 0;
  const lowTotal     = firstPage?.lowTotal     ?? 0;

  const suggestionsQuery = usePurchaseSuggestions(ready && isIdees);
  const suggestions = suggestionsQuery.data ?? [];

  const snooze  = useSnoozeProduct();
  const exclude = useExcludeProduct();
  const deleteSuggestion = useDeleteSuggestion();
  const tapSuggestion    = useTapSuggestion();

  if (!ready) return null;

  function handleSnooze(row: NeededRow) {
    setHiddenIds((prev) => new Set([...prev, row.id]));
    snooze.mutate(row.id, { onError: (e) => { setHiddenIds((prev) => { const n = new Set(prev); n.delete(row.id); return n; }); feedback.error(e); } });
  }

  function handleExclude(row: NeededRow) {
    confirm({
      title: t("Exclure définitivement ?", "استثناء دائم؟"),
      message: t(`Exclure "${row.designation}" ? Il ne réapparaîtra plus jamais.`,
        `استثناء "${row.designation_ar || row.designation}" نهائياً؟`),
      confirmLabel: t("Exclure", "استثناء"),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setHiddenIds((prev) => new Set([...prev, row.id]));
      exclude.mutate(row.id, {
        onError: (e) => { setHiddenIds((prev) => { const n = new Set(prev); n.delete(row.id); return n; }); feedback.error(e); },
      });
    });
  }

  // Suppliers extracted from current product list — small set, no heavy fetch in modal
  const supplierOptions = useMemo(() => {
    const seen = new Set<number>();
    return allRows
      .filter((r) => r.supplier_id != null && !seen.has(r.supplier_id!) && seen.add(r.supplier_id!))
      .map((r) => ({ id: r.supplier_id!, name: r.supplier_name ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);

  const filterCount =
    (activeFilters.supplierId ? 1 : 0) +
    (activeFilters.familyId   ? 1 : 0) +
    (activeFilters.brandId    ? 1 : 0) +
    (activeFilters.supplierCity ? 1 : 0) +
    (activeFilters.datePreset  ? 1 : 0);

  const tabs: { key: TabKey; fr: string; ar: string; count?: number }[] = [
    { key: "all",     fr: "Tout",        ar: "الكل",     count: ruptureTotal + lowTotal },
    { key: "rupture", fr: "En rupture",  ar: "نفاد",     count: ruptureTotal },
    { key: "low",     fr: "Stock faible",ar: "منخفض",    count: lowTotal },
    { key: "idees",   fr: "Idées",       ar: "الاقتراحات", count: suggestions.length || undefined },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>

      {/* ── Tabs ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={main.tabScroll} contentContainerStyle={main.tabContent}>
        {tabs.map(({ key, fr, ar, count }) => (
          <Pressable key={key} onPress={() => setActiveTab(key)}
            style={[main.tab, activeTab === key && main.tabActive]}>
            <Text style={[main.tabTxt, activeTab === key && main.tabTxtActive]}>
              {lang === "ar" ? ar : fr}
              {count != null && count > 0 ? ` (${count})` : ""}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* ── BESOINS tabs ── */}
      {!isIdees ? (
        neededQuery.isLoading && !neededQuery.data ? (
          <LoadingView />
        ) : (
          <FlatList
            data={allRows}
            keyExtractor={(r: NeededRow) => String(r.id)}
            renderItem={({ item: r }) => (
              <ProductCard
                row={r}
                sortBy={sortBy}
                onHistory={() => setHistoryProduct(r)}
                onOrder={() => setOrderProduct(r)}
                onSnooze={() => handleSnooze(r)}
                onExclude={() => handleExclude(r)}
              />
            )}
            ListHeaderComponent={
              <View>
                {/* Search row */}
                <View style={main.searchRow}>
                  <View style={{ flex: 1 }}>
                    <SearchBar value={search} onChangeText={setSearch}
                      placeholder={t("Rechercher un produit…", "بحث عن منتج…")} />
                  </View>
                  <Pressable onPress={() => setFilterOpen(true)}
                    style={[main.filterBtn, filterCount > 0 && main.filterBtnOn]}>
                    <Feather name="filter" size={18} color={filterCount > 0 ? "#fff" : colors.primary} />
                    {filterCount > 0 ? (
                      <View style={main.filterBadge}><Text style={main.filterBadgeTxt}>{filterCount}</Text></View>
                    ) : null}
                  </Pressable>
                </View>
                {/* Sort toggle */}
                <View style={main.sortRow}>
                  <Text style={main.sortLabel}>{t("Trier par:", "ترتيب:")}</Text>
                  {(["profit", "qty_sold"] as const).map((s) => (
                    <Pressable key={s} onPress={() => setSortBy(s)}
                      style={[main.sortBtn, sortBy === s && main.sortBtnOn]}>
                      <Text style={[main.sortTxt, sortBy === s && main.sortTxtOn]}>
                        {s === "profit" ? t("Profit", "الربح") : t("Qté vendue", "المباعة")}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            }
            ListEmptyComponent={
              <EmptyState
                title={t("Aucun produit à réapprovisionner", "لا توجد منتجات تحتاج إعادة تزويد")}
                subtitle={search || filterCount > 0 ? t("Essayez d'autres filtres", "جرب فلاتر أخرى") : undefined}
              />
            }
            onEndReached={() => {
              if (neededQuery.hasNextPage && !neededQuery.isFetchingNextPage) neededQuery.fetchNextPage();
            }}
            onEndReachedThreshold={0.4}
            contentContainerStyle={{ paddingBottom: 40 }}
            refreshing={neededQuery.isRefetching}
            onRefresh={() => {
              setHiddenIds(new Set());
              neededQuery.refetch();
            }}
            scrollEventThrottle={16}
            ListFooterComponent={neededQuery.isFetchingNextPage
              ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
              : null}
          />
        )
      ) : null}

      {/* ── IDÉES tab ── */}
      {isIdees ? (
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
                        image_url: item.image_url ?? "",
                      },
                    })
                  }
                  onDelete={() =>
                    confirm({
                      title: t("Supprimer l'idée ?", "حذف الاقتراح؟"),
                      message: t(`Supprimer "${item.product_name}" ?`, `حذف "${item.product_name}"؟`),
                      confirmLabel: t("Supprimer", "حذف"),
                      destructive: true,
                    }).then((ok) => {
                      if (ok) deleteSuggestion.mutate(item.id, { onError: (e) => feedback.error(e) });
                    })
                  }
                  onTap={() => {
                    setTappingId(item.id);
                    tapSuggestion.mutate(item.id, {
                      onSettled: () => setTappingId(null),
                      onError: (e) => feedback.error(e),
                    });
                  }}
                  onCommander={() =>
                    router.push({
                      pathname: "/(app)/purchase-orders/new",
                      params: { notes: item.product_name },
                    })
                  }
                  tapping={tappingId === item.id}
                />
              )}
              ListEmptyComponent={
                <EmptyState
                  title={t("Aucune idée pour l'instant", "لا توجد اقتراحات بعد")}
                  subtitle={t("Ajoutez la première via le bouton +", "أضف الأول عبر زر +")}
                />
              }
              contentContainerStyle={{ paddingBottom: 96, paddingTop: 4 }}
              refreshing={suggestionsQuery.isRefetching}
              onRefresh={() => suggestionsQuery.refetch()}
            />
          )}
          <Fab onPress={() => router.push("/(app)/smart-purchase/suggestion-form")} testID="fab-add-suggestion" />
        </View>
      ) : null}

      {/* ── Sheets ── */}
      <HistorySheet product={historyProduct} onClose={() => setHistoryProduct(null)} />
      <QuickOrderSheet
        product={orderProduct}
        onClose={() => setOrderProduct(null)}
        onOrdered={(productId) => {
          setOrderProduct(null);
          setHiddenIds((prev) => new Set([...prev, productId]));
        }}
      />
      <FilterModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={activeFilters}
        onApply={setActiveFilters}
        enabled={ready}
        suppliers={supplierOptions}
      />
    </View>
  );
}

const main = StyleSheet.create({
  tabScroll: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  tabContent: { flexDirection: "row", paddingHorizontal: 4 },
  tab: { paddingHorizontal: 16, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabTxt: { fontSize: 13, fontWeight: "500", color: colors.textMuted },
  tabTxtActive: { color: colors.primary, fontWeight: "700" },
  searchRow: { flexDirection: "row", alignItems: "center", paddingRight: 16, gap: 8 },
  filterBtn: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  filterBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterBadge: { position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
  filterBadgeTxt: { fontSize: 9, color: "#fff", fontWeight: "700" },
  sortRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  sortLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  sortBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  sortBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  sortTxt: { fontSize: 12, fontWeight: "600", color: colors.text },
  sortTxtOn: { color: "#fff" },
});
