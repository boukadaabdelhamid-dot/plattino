import React from "react";
import { Text, StyleSheet } from "react-native";
import { useGetLowStock, getGetLowStockQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";
import { colors } from "@/lib/colors";

/**
 * "Achat intelligent" — suggests what to reorder based on products currently
 * below their stock threshold (same low-stock signal the dashboard alerts on).
 */
export default function SmartPurchase() {
  const { ready } = useProtectedRoute({ section: "purchases" });
  const { t } = useLang();

  const { data, isLoading, refetch, isRefetching } = useGetLowStock(undefined, {
    query: { enabled: ready, queryKey: getGetLowStockQueryKey() },
  });

  if (!ready) return null;

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(p: any) => String(p.id)}
      emptyTitle={t("Aucun produit à réapprovisionner", "لا توجد منتجات تحتاج إعادة تزويد")}
      header={<Text style={styles.hint}>{t("Produits en dessous du seuil de stock", "منتجات تحت حد المخزون")}</Text>}
      renderItem={(p: any) => (
        <EntityRow
          title={p.nameEn ?? p.nameAr ?? `#${p.id}`}
          subtitle={p.reference ?? p.barcode ?? ""}
          right={<Badge label={String(p.stock ?? 0)} tone="danger" />}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12.5, color: colors.textMuted, marginHorizontal: 16, marginTop: 16, marginBottom: 4 },
});
