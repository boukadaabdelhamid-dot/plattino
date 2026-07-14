import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useGetProduct,
  useGetProductHistory,
  getGetProductQueryKey,
  getGetProductHistoryQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, Button, LoadingView, SectionTitle, Badge, Divider, ErrorState } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { ready, isAdmin, can } = useProtectedRoute({ section: "products" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const productId = Number(id);

  const { data: product, isLoading, isError } = useGetProduct(productId, {
    query: { enabled: ready && !!productId, queryKey: getGetProductQueryKey(productId) },
  });
  const { data: history } = useGetProductHistory(productId, {
    query: { enabled: ready && !!productId, queryKey: getGetProductHistoryQueryKey(productId) },
  });

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (isError || !product) return <ErrorState title={t("Produit introuvable", "المنتج غير موجود")} />;

  const p = product as any;
  const canEdit = isAdmin || can("products", "edit");

  return (
    <Screen>
      <Card style={{ alignItems: "center" }}>
        {p.imageUrl ? <Image source={{ uri: p.imageUrl }} style={styles.image} /> : null}
        <Text style={styles.name}>{lang === "ar" ? p.nameAr : p.nameEn}</Text>
        <Text style={styles.ref}>{p.reference ?? p.barcode ?? ""}</Text>
        <Badge label={`${t("Stock", "المخزون")}: ${p.stock}`} tone={p.stock <= 0 ? "danger" : "success"} />
      </Card>

      {canEdit ? (
        <Button
          label={t("Modifier le produit", "تعديل المنتج")}
          variant="secondary"
          onPress={() => router.push(`/products/${productId}/edit` as never)}
          testID="button-edit-product"
        />
      ) : null}

      <Card>
        <SectionTitle>{t("Prix", "الأسعار")}</SectionTitle>
        <Row label={t("Prix de vente", "سعر البيع")} value={`${Number(p.price).toLocaleString("fr-FR")} ${currency}`} />
        {p.costPrice ? <Row label={t("Prix de revient", "سعر التكلفة")} value={`${Number(p.costPrice).toLocaleString("fr-FR")} ${currency}`} /> : null}
        {p.priceGros ? <Row label={t("Prix gros", "سعر الجملة")} value={`${Number(p.priceGros).toLocaleString("fr-FR")} ${currency}`} /> : null}
      </Card>

      <Card>
        <SectionTitle>{t("Détails", "التفاصيل")}</SectionTitle>
        {p.brand ? <Row label={t("Marque", "الماركة")} value={p.brand} /> : null}
        {p.color ? <Row label={t("Couleur", "اللون")} value={p.color} /> : null}
        {p.model ? <Row label={t("Modèle", "الموديل")} value={p.model} /> : null}
      </Card>

      {history ? (
        <Card>
          <SectionTitle>{t("Historique", "السجل")}</SectionTitle>
          {(history as any).purchases?.slice(0, 8).map((h: any, i: number) => (
            <View key={i}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.histRow}>
                <Text style={{ flex: 1 }}>{t("Achat", "شراء")} #{h.purchaseOrderId}</Text>
                <Text>x{h.quantity}</Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: 120, height: 120, borderRadius: 12, marginBottom: 10 },
  name: { fontSize: 17, fontWeight: "700", color: colors.text, textAlign: "center" },
  ref: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  rowLabel: { color: colors.textMuted, fontSize: 13 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: "600" },
  histRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
});
