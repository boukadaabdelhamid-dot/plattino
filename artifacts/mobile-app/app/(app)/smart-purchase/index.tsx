import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import {
  useGetLowStock,
  getGetLowStockQueryKey,
  useCreatePurchaseOrder,
  getGetPurchaseOrdersQueryKey,
  type Product,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { ListScreen } from "@/components/ListScreen";
import { Badge, Button } from "@/components/ui";
import { Screen } from "@/components/Screen";
import { PurchaseOrderForm, emptyPurchaseOrderForm, type PurchaseOrderFormValues, type PurchaseOrderLine } from "@/components/PurchaseOrderForm";
import { colors } from "@/lib/colors";

/**
 * "Achat intelligent" — suggests what to reorder based on products currently
 * below their stock threshold. Staff can select suggestions and convert them
 * into a real purchase order (the web ERP only lets staff "snooze" a
 * suggestion; this adds real conversion value without any new endpoint).
 *
 * Backed by GET /admin/low-stock, which is `requireAdmin`-gated and returns
 * plain productsTable rows (real camelCase `Product` shape, no supplier
 * join) — hence the page is admin-only and there is no supplier suggestion.
 */
export default function SmartPurchase() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { t, lang } = useLang();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const { data, isLoading, refetch, isRefetching } = useGetLowStock(undefined, {
    query: { enabled: ready, queryKey: getGetLowStockQueryKey() },
  });
  const items = data ?? [];

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [building, setBuilding] = useState(false);
  const [values, setValues] = useState<PurchaseOrderFormValues>(emptyPurchaseOrderForm());

  const createPO = useCreatePurchaseOrder();

  if (!ready) return null;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startBuilding() {
    const chosen = items.filter((it) => selected.has(it.id));
    const lines: PurchaseOrderLine[] = chosen.map((it) => ({
      product: it,
      quantity: String(Math.max((it.minStock ?? 0) - it.stock, 1)),
      unitCost: it.costPrice ?? "",
    }));

    setValues({ ...emptyPurchaseOrderForm(), lines });
    setBuilding(true);
  }

  function handleSubmit() {
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
        } as any,
      },
      {
        onSuccess: () => {
          feedback.success("Bon d'achat créé", "تم إنشاء أمر الشراء");
          queryClient.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetLowStockQueryKey() });
          setSelected(new Set());
          setBuilding(false);
          setValues(emptyPurchaseOrderForm());
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  if (building) {
    return (
      <Screen>
        <Button
          label={t("← Retour à la sélection", "← الرجوع إلى الاختيار")}
          variant="ghost"
          onPress={() => setBuilding(false)}
          testID="button-back-to-selection"
        />
        <PurchaseOrderForm
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          submitting={createPO.isPending}
          submitLabel={t("Créer le bon d'achat", "إنشاء أمر الشراء")}
        />
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={items}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(p: Product) => String(p.id)}
        emptyTitle={t("Aucun produit à réapprovisionner", "لا توجد منتجات تحتاج إعادة تزويد")}
        header={
          <Text style={styles.hint}>
            {t("Produits en dessous du seuil de stock", "منتجات تحت حد المخزون")}
            {t(" · Sélectionnez des articles pour créer un bon d'achat", " · اختر منتجات لإنشاء أمر شراء")}
          </Text>
        }
        renderItem={(p: Product) => (
          <Pressable
            style={styles.row}
            onPress={() => toggle(p.id)}
            testID={`row-low-stock-${p.id}`}
          >
            <View style={[styles.checkbox, selected.has(p.id) && styles.checkboxChecked]}>
              {selected.has(p.id) ? <Feather name="check" size={14} color="#fff" /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{lang === "ar" ? p.nameAr : p.nameEn}</Text>
              <Text style={styles.sub}>
                {p.reference ?? ""} {p.minStock != null ? t(`· seuil ${p.minStock}`, `· الحد ${p.minStock}`) : ""}
              </Text>
            </View>
            <Badge label={String(p.stock)} tone="danger" />
          </Pressable>
        )}
      />
      {selected.size > 0 ? (
        <View style={styles.footer}>
          <Button
            label={t(`Construire le bon d'achat (${selected.size})`, `إنشاء أمر شراء (${selected.size})`)}
            onPress={startBuilding}
            testID="button-build-purchase-order"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12.5, color: colors.textMuted, marginHorizontal: 16, marginTop: 16, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  name: { fontSize: 14, fontWeight: "600", color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
});
