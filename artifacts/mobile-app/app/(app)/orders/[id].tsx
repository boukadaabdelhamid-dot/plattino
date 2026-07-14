import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useGetOrder, getGetOrderQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, LoadingView, SectionTitle, Badge, Divider, ErrorState } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready } = useProtectedRoute({ section: "orders" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const orderId = Number(id);

  const { data: order, isLoading, isError } = useGetOrder(orderId, {
    query: { enabled: ready && !!orderId, queryKey: getGetOrderQueryKey(orderId) },
  });

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (isError || !order) return <ErrorState title={t("Commande introuvable", "الطلب غير موجود")} />;

  const items = (order as any).items ?? [];

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Commande", "الطلب")} #{order.id}</SectionTitle>
        <Badge label={order.status} />
        <Divider />
        <Text style={styles.label}>{t("Client", "العميل")}</Text>
        <Text style={styles.value}>{order.customerName}</Text>
        <Text style={styles.label}>{t("Téléphone", "الهاتف")}</Text>
        <Text style={styles.value}>{order.customerPhone}</Text>
        <Text style={styles.label}>{t("Adresse", "العنوان")}</Text>
        <Text style={styles.value}>{order.customerAddress}</Text>
      </Card>

      <Card>
        <SectionTitle>{t("Articles", "المنتجات")}</SectionTitle>
        {items.length === 0 ? (
          <Text style={styles.muted}>{t("Aucun article", "لا توجد منتجات")}</Text>
        ) : (
          items.map((it: any, i: number) => (
            <View key={it.id ?? i}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.itemRow}>
                <Text style={{ flex: 1 }}>{it.product?.nameFr ?? it.product?.nameEn ?? `#${it.productId}`}</Text>
                <Text>x{it.quantity}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t("Total", "الإجمالي")}</Text>
          <Text style={styles.totalValue}>{Number(order.totalAmount).toLocaleString("fr-FR")} {currency}</Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, color: colors.textMuted, marginTop: 8 },
  value: { fontSize: 14, color: colors.text, fontWeight: "500" },
  muted: { fontSize: 13, color: colors.textMuted },
  itemRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  totalValue: { fontSize: 18, fontWeight: "700", color: colors.primary },
});
