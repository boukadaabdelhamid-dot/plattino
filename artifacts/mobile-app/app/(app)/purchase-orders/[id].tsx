import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  useGetPurchaseOrderItems,
  useGetPurchaseOrders,
  getGetPurchaseOrdersQueryKey,
  getGetPurchaseOrderItemsQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, LoadingView, SectionTitle, Badge, Divider, ErrorState } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function PurchaseOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready } = useProtectedRoute({ section: "purchases" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const poId = Number(id);

  const poListParams = { limit: 200 };
  const { data: list, isLoading } = useGetPurchaseOrders(poListParams, {
    query: { enabled: ready, queryKey: getGetPurchaseOrdersQueryKey(poListParams) },
  });
  const po = ((list as any)?.data ?? []).find((p: any) => p.id === poId);
  const { data: items } = useGetPurchaseOrderItems(poId, {
    query: { enabled: ready && !!poId, queryKey: getGetPurchaseOrderItemsQueryKey(poId) },
  });

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (!po) return <ErrorState title={t("Bon d'achat introuvable", "أمر الشراء غير موجود")} />;

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Bon d'achat", "أمر الشراء")} #{po.id}</SectionTitle>
        <Badge label={po.status} />
        {po.notes ? (
          <>
            <Divider />
            <Text style={styles.notes}>{po.notes}</Text>
          </>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t("Articles", "المنتجات")}</SectionTitle>
        {!items || (items as any[]).length === 0 ? (
          <Text style={styles.muted}>{t("Aucun article", "لا توجد منتجات")}</Text>
        ) : (
          (items as any[]).map((it, i) => (
            <View key={it.id ?? i}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <Text style={{ flex: 1 }} numberOfLines={1}>{it.productNameEn ?? it.productNameAr ?? `#${it.productId}`}</Text>
                <Text>{it.quantity} × {Number(it.unitCost).toLocaleString("fr-FR")} {currency}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t("Total", "الإجمالي")}</Text>
          <Text style={styles.totalValue}>{Number(po.totalAmount ?? 0).toLocaleString("fr-FR")} {currency}</Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  notes: { fontSize: 13, color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  totalValue: { fontSize: 18, fontWeight: "700", color: colors.primary },
});
