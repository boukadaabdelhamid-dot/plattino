import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useGetCategories, getGetCategoriesQueryKey, type Category, type Product } from "@workspace/api-client-react";
import { useLang } from "@/contexts/lang-context";
import { Card, Button, FormField, SectionTitle, Divider } from "@/components/ui";
import { PickerField } from "@/components/Picker";
import { colors } from "@/lib/colors";

export type ProductFormValues = {
  nameEn: string;
  nameAr: string;
  price: string;
  costPrice: string;
  priceGros: string;
  stock: string;
  minStock: string;
  reference: string;
  barcode: string;
  brand: string;
  model: string;
  color: string;
  categoryId: number | null;
  isActive: boolean;
  isExposed: boolean;
};

export function emptyProductForm(): ProductFormValues {
  return {
    nameEn: "",
    nameAr: "",
    price: "",
    costPrice: "",
    priceGros: "",
    stock: "0",
    minStock: "",
    reference: "",
    barcode: "",
    brand: "",
    model: "",
    color: "",
    categoryId: null,
    isActive: true,
    isExposed: true,
  };
}

export function productToForm(p: Product): ProductFormValues {
  return {
    nameEn: p.nameEn ?? "",
    nameAr: p.nameAr ?? "",
    price: p.price != null ? String(p.price) : "",
    costPrice: p.costPrice != null ? String(p.costPrice) : "",
    priceGros: p.priceGros != null ? String(p.priceGros) : "",
    stock: p.stock != null ? String(p.stock) : "0",
    minStock: p.minStock != null ? String(p.minStock) : "",
    reference: p.reference ?? "",
    barcode: p.barcode ?? "",
    brand: p.brand ?? "",
    model: p.model ?? "",
    color: p.color ?? "",
    categoryId: p.categoryId ?? null,
    isActive: p.isActive ?? true,
    isExposed: p.isExposed ?? true,
  };
}

/**
 * Shared create/edit product form, mirroring the web ERP's product dialog
 * fields. `mode="create"` also shows the initial stock field (stock can only
 * be seeded at creation — later changes flow through inventory movements /
 * purchase receptions, matching the web app).
 */
export function ProductForm({
  mode,
  values,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
}: {
  mode: "create" | "edit";
  values: ProductFormValues;
  onChange: (next: ProductFormValues) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const { t, lang } = useLang();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: categoriesData } = useGetCategories({
    query: { queryKey: getGetCategoriesQueryKey() },
  });
  const categories = (categoriesData ?? []) as Category[];
  const selectedCategory = categories.find((c) => c.id === values.categoryId) ?? null;

  function set<K extends keyof ProductFormValues>(key: K, v: ProductFormValues[K]) {
    onChange({ ...values, [key]: v });
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.nameEn.trim()) next.nameEn = t("Requis", "مطلوب");
    if (!values.nameAr.trim()) next.nameAr = t("Requis", "مطلوب");
    if (!values.price.trim() || Number.isNaN(Number(values.price))) next.price = t("Prix invalide", "سعر غير صالح");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    onSubmit();
  }

  return (
    <View>
      <Card>
        <SectionTitle>{t("Identité", "الهوية")}</SectionTitle>
        <FormField label={t("Nom du produit", "اسم المنتج (فرنسي)")} value={values.nameEn} onChangeText={(v) => set("nameEn", v)} error={errors.nameEn} />
        <FormField label={t("Nom (arabe)", "الاسم بالعربية")} value={values.nameAr} onChangeText={(v) => set("nameAr", v)} error={errors.nameAr} />
        <PickerField<Category>
          label={t("Catégorie", "الفئة")}
          value={selectedCategory}
          items={categories}
          keyExtractor={(c) => String(c.id)}
          labelExtractor={(c) => (lang === "ar" ? c.nameAr : c.nameEn)}
          onChange={(c) => set("categoryId", c.id)}
          placeholder={t("Aucune catégorie", "بدون فئة")}
        />
      </Card>

      <Card>
        <SectionTitle>{t("Prix", "الأسعار")}</SectionTitle>
        <FormField label={t("Prix de vente", "سعر البيع")} value={values.price} onChangeText={(v) => set("price", v)} keyboardType="decimal-pad" error={errors.price} />
        <FormField label={t("Prix de revient", "سعر التكلفة")} value={values.costPrice} onChangeText={(v) => set("costPrice", v)} keyboardType="decimal-pad" />
        <FormField label={t("Prix gros", "سعر الجملة")} value={values.priceGros} onChangeText={(v) => set("priceGros", v)} keyboardType="decimal-pad" />
      </Card>

      <Card>
        <SectionTitle>{t("Stock", "المخزون")}</SectionTitle>
        {mode === "create" ? (
          <FormField label={t("Stock initial", "المخزون الابتدائي")} value={values.stock} onChangeText={(v) => set("stock", v)} keyboardType="numeric" />
        ) : null}
        <FormField label={t("Seuil d'alerte", "حد التنبيه")} value={values.minStock} onChangeText={(v) => set("minStock", v)} keyboardType="numeric" />
      </Card>

      <Card>
        <SectionTitle>{t("Identification", "التعريف")}</SectionTitle>
        <FormField label={t("Référence", "المرجع")} value={values.reference} onChangeText={(v) => set("reference", v)} autoCapitalize="none" />
        <FormField label={t("Code-barres", "الرمز الشريطي")} value={values.barcode} onChangeText={(v) => set("barcode", v)} autoCapitalize="none" keyboardType="numeric" />
        <FormField label={t("Marque", "الماركة")} value={values.brand} onChangeText={(v) => set("brand", v)} />
        <FormField label={t("Modèle", "الموديل")} value={values.model} onChangeText={(v) => set("model", v)} />
        <FormField label={t("Couleur", "اللون")} value={values.color} onChangeText={(v) => set("color", v)} />
      </Card>

      <Card>
        <SectionTitle>{t("Visibilité", "الظهور")}</SectionTitle>
        <ToggleRow label={t("Produit actif", "منتج نشط")} value={values.isActive} onChange={(v) => set("isActive", v)} />
        <Divider />
        <ToggleRow label={t("Visible en vitrine", "ظاهر في الواجهة")} value={values.isExposed} onChange={(v) => set("isExposed", v)} />
      </Card>

      <Button label={submitLabel} onPress={handleSubmit} loading={submitting} testID="button-submit-product" />
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Button label={value ? "✓" : ""} variant={value ? "primary" : "secondary"} onPress={() => onChange(!value)} style={styles.toggleBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  toggleLabel: { fontSize: 14, color: colors.text, fontWeight: "500" },
  toggleBtn: { width: 44, paddingVertical: 6 },
});
