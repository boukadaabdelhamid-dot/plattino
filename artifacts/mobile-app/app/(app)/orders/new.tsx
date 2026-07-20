import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateOrder,
  useGetProducts,
  getGetProductsQueryKey,
  useGetErpCustomers,
  getGetErpCustomersQueryKey,
  getGetAdminOrdersQueryKey,
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

export default function NewOrder() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "orders" });
  const { t, lang, isRTL } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const currency = lang === "ar" ? "دج" : "DA";

  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState(t("Vente comptoir", "بيع في المتجر"));
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMode, setPaymentMode] = useState<"comptant" | "terme">("comptant");
  const [versement, setVersement] = useState("");

  const productsParams = { limit: 9999 };
  const { data: productsData, isLoading: productsLoading } = useGetProducts(productsParams, {
    query: { enabled: ready, queryKey: getGetProductsQueryKey(productsParams) },
  });
  const products = (
    ((productsData as unknown as { products?: Product[] })?.products ?? []) as Product[]
  ).filter((p) => p.stock > 0);

  const customersParams = { limit: 200 };
  const { data: customersData } = useGetErpCustomers(customersParams, {
    query: { enabled: ready, queryKey: getGetErpCustomersQueryKey(customersParams) },
  });
  const customers = ((customersData as unknown as { data?: CustomerSummary[] })?.data ?? []) as CustomerSummary[];

  const createOrder = useCreateOrder();

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
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: Math.min(l.quantity + 1, product.stock) } : l,
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  }

  function updateQuantity(productId: number, quantity: number) {
    setCart((prev) => prev.map((l) => (l.product.id === productId ? { ...l, quantity } : l)));
  }

  function removeLine(productId: number) {
    setCart((prev) => prev.filter((l) => l.product.id !== productId));
  }

  function selectCustomer(c: CustomerSummary) {
    setCustomer(c);
    setCustomerName(c.name);
    if (c.phone) setCustomerPhone(c.phone);
    if (c.address) setCustomerAddress(c.address);
  }

  function handleSubmit() {
    if (cart.length === 0) {
      feedback.error(null, "Ajoutez au moins un produit", "أضف منتجاً واحداً على الأقل");
      return;
    }
    if (!customerName.trim()) {
      feedback.error(null, "Le nom du client est requis", "اسم العميل مطلوب");
      return;
    }
    if (paymentMode === "terme" && !customer) {
      feedback.error(
        null,
        "Une vente à terme requiert un client sélectionné",
        "البيع بالتقسيط يتطلب اختيار عميل",
      );
      return;
    }

    createOrder.mutate(
      {
        data: {
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || "0000000000",
          customerAddress: customerAddress.trim() || t("Vente comptoir", "بيع في المتجر"),
          items: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          linkedCustomerId: customer?.id ?? null,
          paymentMode,
          versement: paymentMode === "terme" ? Number(versement) || 0 : undefined,
        },
      },
      {
        onSuccess: (order) => {
          feedback.success("Commande créée", "تم إنشاء الطلب");
          queryClient.invalidateQueries({ queryKey: getGetAdminOrdersQueryKey() });
          router.replace(`/orders/${order.id}` as never);
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
          label={t("Client enregistré (optionnel)", "عميل مسجل (اختياري)")}
          value={customer}
          items={customers}
          keyExtractor={(c) => String(c.id)}
          labelExtractor={(c) => c.name}
          subtitleExtractor={(c) => c.phone ?? undefined}
          onChange={selectCustomer}
          placeholder={t("Vente comptoir (client par défaut)", "بيع في المتجر (عميل افتراضي)")}
        />
        <FormField label={t("Nom du client", "اسم العميل")} value={customerName} onChangeText={setCustomerName} />
        <FormField
          label={t("Téléphone", "الهاتف")}
          value={customerPhone}
          onChangeText={setCustomerPhone}
          keyboardType="phone-pad"
        />
        <FormField label={t("Adresse", "العنوان")} value={customerAddress} onChangeText={setCustomerAddress} />
      </Card>

      <Card>
        <SectionTitle>{t("Produits", "المنتجات")}</SectionTitle>
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
                <QuantityStepper
                  value={line.quantity}
                  onChange={(q) => updateQuantity(line.product.id, q)}
                  max={line.product.stock}
                />
                <Pressable onPress={() => removeLine(line.product.id)} hitSlop={8} testID={`button-remove-line-${line.product.id}`}>
                  <Feather name="trash-2" size={18} color={colors.danger} />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <SectionTitle>{t("Paiement", "الدفع")}</SectionTitle>
        <View style={[styles.paymentRow, isRTL && styles.cartRowRTL]}>
          <Button
            label={t("Comptant", "نقداً")}
            variant={paymentMode === "comptant" ? "primary" : "secondary"}
            onPress={() => setPaymentMode("comptant")}
            style={{ flex: 1 }}
            testID="button-payment-comptant"
          />
          <Button
            label={t("À terme", "بالتقسيط")}
            variant={paymentMode === "terme" ? "primary" : "secondary"}
            onPress={() => setPaymentMode("terme")}
            style={{ flex: 1 }}
            testID="button-payment-terme"
          />
        </View>
        {paymentMode === "terme" ? (
          <FormField
            label={t("Acompte (versement)", "دفعة أولى")}
            value={versement}
            onChangeText={setVersement}
            keyboardType="decimal-pad"
            placeholder="0"
          />
        ) : null}
        <Divider />
        <View style={[styles.totalRow, isRTL && styles.cartRowRTL]}>
          <Text style={styles.totalLabel}>{t("Total estimé", "الإجمالي التقديري")}</Text>
          <Text style={styles.totalValue}>{total.toLocaleString("fr-FR")} {currency}</Text>
        </View>
      </Card>

      <Button
        label={t("Créer la commande", "إنشاء الطلب")}
        onPress={handleSubmit}
        loading={createOrder.isPending}
        testID="button-submit-order"
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
