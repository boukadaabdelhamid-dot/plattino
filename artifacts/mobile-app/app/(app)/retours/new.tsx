import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateStandaloneRetour,
  useGetProducts,
  getGetProductsQueryKey,
  useGetErpCustomers,
  getGetErpCustomersQueryKey,
  getGetAdminRetoursQueryKey,
  type Product,
  type CustomerSummary,
} from "@workspace/api-client-react";
import { Feather } from "@expo/vector-icons";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle, Divider, ErrorState } from "@/components/ui";
import { PickerField } from "@/components/Picker";
import { QuantityStepper } from "@/components/QuantityStepper";
import { colors } from "@/lib/colors";

type CartLine = { product: Product; quantity: number };

export default function NewRetour() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "orders" });
  const { t, lang, isRTL } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const currency = lang === "ar" ? "دج" : "DA";

  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [reason, setReason] = useState("");
  const [retourType, setRetourType] = useState<"remboursement" | "sans_remboursement">("remboursement");

  const productsParams = { limit: 500 };
  const { data: productsData, isLoading: productsLoading } = useGetProducts(productsParams, {
    query: { enabled: ready, queryKey: getGetProductsQueryKey(productsParams) },
  });
  const products = ((productsData as unknown as { products?: Product[] })?.products ?? []) as Product[];

  const customersParams = { limit: 200 };
  const { data: customersData } = useGetErpCustomers(customersParams, {
    query: { enabled: ready, queryKey: getGetErpCustomersQueryKey(customersParams) },
  });
  const customers = ((customersData as unknown as { data?: CustomerSummary[] })?.data ?? []) as CustomerSummary[];

  const createRetour = useCreateStandaloneRetour();

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0),
    [cart],
  );

  const canCreate = isAdmin || can("orders", "create");

  if (!ready) return null;
  if (!canCreate) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }

  function addProduct(product: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) return prev.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { product, quantity: 1 }];
    });
  }

  function updateQuantity(productId: number, quantity: number) {
    setCart((prev) => prev.map((l) => (l.product.id === productId ? { ...l, quantity } : l)));
  }

  function removeLine(productId: number) {
    setCart((prev) => prev.filter((l) => l.product.id !== productId));
  }

  function handleSubmit() {
    if (cart.length === 0) {
      feedback.error(null, "Ajoutez au moins un produit", "أضف منتجاً واحداً على الأقل");
      return;
    }
    if (retourType === "sans_remboursement" && !customer) {
      feedback.error(
        null,
        "Un retour sans remboursement nécessite un client sélectionné",
        "الاسترجاع بدون استرداد يتطلب اختيار عميل",
      );
      return;
    }

    createRetour.mutate(
      {
        data: {
          clientUserId: customer?.id ?? null,
          clientName: customer?.name ?? null,
          reason: reason.trim() || null,
          retourType,
          items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        },
      },
      {
        onSuccess: () => {
          feedback.success("Retour créé", "تم إنشاء الاسترجاع");
          queryClient.invalidateQueries({ queryKey: getGetAdminRetoursQueryKey() });
          router.replace("/retours" as never);
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Client", "العميل")}</SectionTitle>
        <PickerField<CustomerSummary>
          label={t("Client (optionnel)", "العميل (اختياري)")}
          value={customer}
          items={customers}
          keyExtractor={(c) => String(c.id)}
          labelExtractor={(c) => c.name}
          subtitleExtractor={(c) => c.phone ?? undefined}
          onChange={setCustomer}
          placeholder={t("DIVERS COMPTOIR (par défaut)", "متنوع (افتراضي)")}
        />
      </Card>

      <Card>
        <SectionTitle>{t("Produits retournés", "المنتجات المسترجعة")}</SectionTitle>
        <PickerField<Product>
          label={t("Ajouter un produit", "إضافة منتج")}
          value={null}
          items={products}
          keyExtractor={(p) => String(p.id)}
          labelExtractor={(p) => (lang === "ar" ? p.nameAr : p.nameEn)}
          subtitleExtractor={(p) => `${p.reference ?? p.barcode ?? ""} · ${Number(p.price).toLocaleString("fr-FR")} ${currency}`}
          onChange={addProduct}
          placeholder={t("Rechercher un produit...", "بحث عن منتج...")}
          disabled={productsLoading}
        />

        {cart.length === 0 ? (
          <Text style={styles.muted}>{t("Aucun produit ajouté", "لم تتم إضافة أي منتج")}</Text>
        ) : (
          cart.map((line, i) => (
            <View key={line.product.id}>
              {i > 0 ? <Divider /> : null}
              <View style={[styles.cartRow, isRTL && styles.cartRowRTL]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cartName} numberOfLines={1}>
                    {lang === "ar" ? line.product.nameAr : line.product.nameEn}
                  </Text>
                  <Text style={styles.cartSub}>
                    {Number(line.product.price).toLocaleString("fr-FR")} {currency}
                  </Text>
                </View>
                <QuantityStepper value={line.quantity} onChange={(q) => updateQuantity(line.product.id, q)} />
                <Pressable onPress={() => removeLine(line.product.id)} hitSlop={8} testID={`button-remove-line-${line.product.id}`}>
                  <Feather name="trash-2" size={18} color={colors.danger} />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <SectionTitle>{t("Détails", "التفاصيل")}</SectionTitle>
        <View style={[styles.paymentRow, isRTL && styles.cartRowRTL]}>
          <Button
            label={t("Remboursement", "استرداد")}
            variant={retourType === "remboursement" ? "primary" : "secondary"}
            onPress={() => setRetourType("remboursement")}
            style={{ flex: 1 }}
            testID="button-retour-type-remboursement"
          />
          <Button
            label={t("Sans remboursement", "بدون استرداد")}
            variant={retourType === "sans_remboursement" ? "primary" : "secondary"}
            onPress={() => setRetourType("sans_remboursement")}
            style={{ flex: 1 }}
            testID="button-retour-type-sans-remboursement"
          />
        </View>
        <FormField label={t("Motif", "السبب")} value={reason} onChangeText={setReason} multiline />
        <Divider />
        <View style={[styles.totalRow, isRTL && styles.cartRowRTL]}>
          <Text style={styles.totalLabel}>{t("Total estimé", "الإجمالي التقديري")}</Text>
          <Text style={styles.totalValue}>{total.toLocaleString("fr-FR")} {currency}</Text>
        </View>
      </Card>

      <Button
        label={t("Créer le retour", "إنشاء الاسترجاع")}
        onPress={handleSubmit}
        loading={createRetour.isPending}
        testID="button-submit-retour"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  cartRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  cartRowRTL: { flexDirection: "row-reverse" },
  cartName: { fontSize: 14, fontWeight: "600", color: colors.text },
  cartSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  paymentRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  totalLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  totalValue: { fontSize: 18, fontWeight: "700", color: colors.primary },
});
