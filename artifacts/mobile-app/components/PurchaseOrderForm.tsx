import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  useGetSuppliers,
  getGetSuppliersQueryKey,
  useGetProducts,
  getGetProductsQueryKey,
  type Supplier,
  type Product,
} from "@workspace/api-client-react";
import { useLang } from "@/contexts/lang-context";
import { Card, Button, FormField, SectionTitle, Divider } from "@/components/ui";
import { PickerField } from "@/components/Picker";
import { colors } from "@/lib/colors";

export type PurchaseOrderLine = { product: Product; quantity: string; unitCost: string };

export type PurchaseOrderFormValues = {
  supplier: Supplier | null;
  notes: string;
  paymentMethod: "comptant" | "a_terme";
  lines: PurchaseOrderLine[];
};

export function emptyPurchaseOrderForm(): PurchaseOrderFormValues {
  return { supplier: null, notes: "", paymentMethod: "a_terme", lines: [] };
}

/**
 * Shared create/edit purchase-order form: pick a supplier, build a cart of
 * product + quantity + unit cost lines, choose payment method. Editing is
 * only allowed by the caller while the PO is still `pending`.
 */
export function PurchaseOrderForm({
  values,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
}: {
  values: PurchaseOrderFormValues;
  onChange: (next: PurchaseOrderFormValues) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const { t, lang, isRTL } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const [error, setError] = useState("");

  const suppliersParams = { limit: 200 };
  const { data: suppliersData } = useGetSuppliers(suppliersParams, {
    query: { queryKey: getGetSuppliersQueryKey(suppliersParams) },
  });
  const suppliers = ((suppliersData as unknown as { data?: Supplier[] })?.data ?? []) as Supplier[];

  const productsParams = { limit: 500 };
  const { data: productsData } = useGetProducts(productsParams, {
    query: { queryKey: getGetProductsQueryKey(productsParams) },
  });
  const products = ((productsData as unknown as { products?: Product[] })?.products ?? []) as Product[];

  const total = useMemo(
    () => values.lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0),
    [values.lines],
  );

  function set<K extends keyof PurchaseOrderFormValues>(key: K, v: PurchaseOrderFormValues[K]) {
    onChange({ ...values, [key]: v });
  }

  function addProduct(product: Product) {
    const existing = values.lines.find((l) => l.product.id === product.id);
    if (existing) return;
    set("lines", [...values.lines, { product, quantity: "1", unitCost: product.costPrice ?? "" }]);
  }

  function updateLine(productId: number, patch: Partial<PurchaseOrderLine>) {
    set("lines", values.lines.map((l) => (l.product.id === productId ? { ...l, ...patch } : l)));
  }

  function removeLine(productId: number) {
    set("lines", values.lines.filter((l) => l.product.id !== productId));
  }

  function handleSubmit() {
    if (!values.supplier) {
      setError(t("Sélectionnez un fournisseur", "اختر مورداً"));
      return;
    }
    if (values.lines.length === 0) {
      setError(t("Ajoutez au moins un article", "أضف منتجاً واحداً على الأقل"));
      return;
    }
    for (const l of values.lines) {
      if (!Number(l.quantity) || Number(l.quantity) <= 0 || !l.unitCost.trim() || Number.isNaN(Number(l.unitCost))) {
        setError(t("Vérifiez les quantités et coûts", "تحقق من الكميات والتكاليف"));
        return;
      }
    }
    setError("");
    onSubmit();
  }

  return (
    <View>
      <Card>
        <SectionTitle>{t("Fournisseur", "المورد")}</SectionTitle>
        <PickerField<Supplier>
          label={t("Fournisseur", "المورد")}
          value={values.supplier}
          items={suppliers}
          keyExtractor={(s) => String(s.id)}
          labelExtractor={(s) => s.name}
          subtitleExtractor={(s) => s.phone ?? undefined}
          onChange={(s) => set("supplier", s)}
          placeholder={t("Sélectionner...", "اختر...")}
        />
        <FormField label={t("Notes", "ملاحظات")} value={values.notes} onChangeText={(v) => set("notes", v)} multiline />
      </Card>

      <Card>
        <SectionTitle>{t("Paiement", "الدفع")}</SectionTitle>
        <View style={[styles.paymentRow, isRTL && styles.rowRTL]}>
          <Button
            label={t("À terme", "بالتقسيط")}
            variant={values.paymentMethod === "a_terme" ? "primary" : "secondary"}
            onPress={() => set("paymentMethod", "a_terme")}
            style={{ flex: 1 }}
          />
          <Button
            label={t("Comptant", "نقداً")}
            variant={values.paymentMethod === "comptant" ? "primary" : "secondary"}
            onPress={() => set("paymentMethod", "comptant")}
            style={{ flex: 1 }}
          />
        </View>
      </Card>

      <Card>
        <SectionTitle>{t("Articles", "المنتجات")}</SectionTitle>
        <PickerField<Product>
          label={t("Ajouter un produit", "إضافة منتج")}
          value={null}
          items={products}
          keyExtractor={(p) => String(p.id)}
          labelExtractor={(p) => (lang === "ar" ? p.nameAr : p.nameEn)}
          subtitleExtractor={(p) => p.reference ?? p.barcode ?? undefined}
          onChange={addProduct}
          placeholder={t("Rechercher un produit...", "بحث عن منتج...")}
        />
        {values.lines.length === 0 ? (
          <Text style={styles.muted}>{t("Aucun article ajouté", "لم تتم إضافة أي منتج")}</Text>
        ) : (
          values.lines.map((line, i) => (
            <View key={line.product.id}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.lineHeader}>
                <Text style={styles.lineName} numberOfLines={1}>
                  {lang === "ar" ? line.product.nameAr : line.product.nameEn}
                </Text>
                <Pressable onPress={() => removeLine(line.product.id)} hitSlop={8} testID={`button-remove-line-${line.product.id}`}>
                  <Feather name="trash-2" size={18} color={colors.danger} />
                </Pressable>
              </View>
              <View style={[styles.lineRow, isRTL && styles.rowRTL]}>
                <FormField
                  label={t("Quantité", "الكمية")}
                  value={line.quantity}
                  onChangeText={(v) => updateLine(line.product.id, { quantity: v })}
                  keyboardType="numeric"
                />
                <FormField
                  label={t(`Coût unitaire (${currency})`, `تكلفة الوحدة (${currency})`)}
                  value={line.unitCost}
                  onChangeText={(v) => updateLine(line.product.id, { unitCost: v })}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t("Total estimé", "الإجمالي التقديري")}</Text>
          <Text style={styles.totalValue}>{total.toLocaleString("fr-FR")} {currency}</Text>
        </View>
      </Card>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={submitLabel} onPress={handleSubmit} loading={submitting} testID="button-submit-purchase-order" />
    </View>
  );
}

const styles = StyleSheet.create({
  paymentRow: { flexDirection: "row", gap: 10 },
  rowRTL: { flexDirection: "row-reverse" },
  muted: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  lineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, marginBottom: 4 },
  lineName: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
  lineRow: { flexDirection: "row", gap: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  totalValue: { fontSize: 18, fontWeight: "700", color: colors.primary },
  error: { color: colors.danger, fontSize: 13, textAlign: "center", marginBottom: 4 },
});
