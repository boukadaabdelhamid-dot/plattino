import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import {
  useCreateErpTransfer,
  useGetErpStoresAll,
  getGetErpStoresAllQueryKey,
  useGetProducts,
  getGetProductsQueryKey,
  getGetErpTransfersQueryKey,
  type Store,
  type Product,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useStoreContext } from "@/contexts/store-context";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle, Divider, ErrorState } from "@/components/ui";
import { PickerField } from "@/components/Picker";
import { QuantityStepper } from "@/components/QuantityStepper";
import { colors } from "@/lib/colors";

type CartLine = { product: Product; quantity: number };

/**
 * Push-direction transfer creation only: current store is always the
 * source, staff pick a destination store and build a cart from their own
 * catalog. Pulling stock from another store's catalog requires an
 * admin-only cross-store product endpoint with no generated hook — see
 * follow-up task for pull-mode initiation from mobile.
 */
export default function NewTransfer() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "inventory" });
  const { currentStoreId } = useStoreContext();
  const { t, lang, isRTL } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const [destination, setDestination] = useState<Store | null>(null);
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<"request" | "send">("request");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [error, setError] = useState("");

  const { data: storesData } = useGetErpStoresAll({
    query: { enabled: ready, queryKey: getGetErpStoresAllQueryKey() },
  });
  const stores = ((storesData ?? []) as Store[]).filter((s) => s.id !== currentStoreId);

  const productsParams = { limit: 500 };
  const { data: productsData, isLoading: productsLoading } = useGetProducts(productsParams, {
    query: { enabled: ready, queryKey: getGetProductsQueryKey(productsParams) },
  });
  const products = (
    ((productsData as unknown as { products?: Product[] })?.products ?? []) as Product[]
  ).filter((p) => p.stock > 0);

  const createTransfer = useCreateErpTransfer();

  const totalQty = useMemo(() => cart.reduce((sum, l) => sum + l.quantity, 0), [cart]);
  const canCreate = isAdmin || can("inventory", "create");
  const canSend = isAdmin;

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

  function handleSubmit() {
    if (!destination) {
      setError(t("Sélectionnez un magasin de destination", "اختر متجراً وجهة"));
      return;
    }
    if (cart.length === 0) {
      setError(t("Ajoutez au moins un produit", "أضف منتجاً واحداً على الأقل"));
      return;
    }
    setError("");

    createTransfer.mutate(
      {
        data: {
          destinationStoreId: destination.id,
          notes: notes.trim() || undefined,
          mode: canSend ? mode : "request",
          items: cart.map((l) => ({ sourceProductId: l.product.id, quantity: l.quantity })),
        },
      },
      {
        onSuccess: (transfer) => {
          feedback.success("Transfert créé", "تم إنشاء التحويل");
          queryClient.invalidateQueries({ queryKey: getGetErpTransfersQueryKey() });
          router.replace(`/transfers/${transfer.id}` as never);
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Destination", "الوجهة")}</SectionTitle>
        <PickerField<Store>
          label={t("Magasin de destination", "متجر الوجهة")}
          value={destination}
          items={stores}
          keyExtractor={(s) => String(s.id)}
          labelExtractor={(s) => (lang === "ar" ? s.nameAr : s.nameEn)}
          onChange={setDestination}
          placeholder={t("Sélectionner...", "اختر...")}
        />
        <FormField label={t("Notes", "ملاحظات")} value={notes} onChangeText={setNotes} multiline />
        {canSend ? (
          <View style={[styles.modeRow, isRTL && styles.rowRTL]}>
            <Button
              label={t("Demande (avec approbation)", "طلب (بموافقة)")}
              variant={mode === "request" ? "primary" : "secondary"}
              onPress={() => setMode("request")}
              style={{ flex: 1 }}
            />
            <Button
              label={t("Envoi direct", "إرسال مباشر")}
              variant={mode === "send" ? "primary" : "secondary"}
              onPress={() => setMode("send")}
              style={{ flex: 1 }}
            />
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t("Produits", "المنتجات")}</SectionTitle>
        <PickerField<Product>
          label={t("Ajouter un produit", "إضافة منتج")}
          value={null}
          items={products}
          keyExtractor={(p) => String(p.id)}
          labelExtractor={(p) => (lang === "ar" ? p.nameAr : p.nameEn)}
          subtitleExtractor={(p) => `${p.reference ?? p.barcode ?? ""} · ${t("Stock", "المخزون")}: ${p.stock}`}
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
              <View style={[styles.cartRow, isRTL && styles.rowRTL]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cartName} numberOfLines={1}>
                    {lang === "ar" ? line.product.nameAr : line.product.nameEn}
                  </Text>
                  <Text style={styles.cartSub}>{t("Disponible", "متوفر")}: {line.product.stock}</Text>
                </View>
                <QuantityStepper value={line.quantity} onChange={(q) => updateQuantity(line.product.id, q)} max={line.product.stock} />
                <Pressable onPress={() => removeLine(line.product.id)} hitSlop={8} testID={`button-remove-line-${line.product.id}`}>
                  <Feather name="trash-2" size={18} color={colors.danger} />
                </Pressable>
              </View>
            </View>
          ))
        )}
      </Card>

      {cart.length > 0 ? (
        <Card>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t("Quantité totale", "الكمية الإجمالية")}</Text>
            <Text style={styles.totalValue}>{totalQty}</Text>
          </View>
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={t("Créer le transfert", "إنشاء التحويل")}
        onPress={handleSubmit}
        loading={createTransfer.isPending}
        testID="button-submit-transfer"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  modeRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  rowRTL: { flexDirection: "row-reverse" },
  muted: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  cartRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  cartName: { fontSize: 14, fontWeight: "600", color: colors.text },
  cartSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  totalValue: { fontSize: 18, fontWeight: "700", color: colors.primary },
  error: { color: colors.danger, fontSize: 13, textAlign: "center" },
});
