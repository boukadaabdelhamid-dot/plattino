import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useGetErpTransfers, getGetErpTransfersQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge, Button } from "@/components/ui";
import { Fab } from "@/components/Fab";
import { View as RNView } from "react-native";
import { colors } from "@/lib/colors";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  requested: "warning",
  approved: "info",
  prepared: "info",
  in_transit: "info",
  received: "success",
  rejected: "danger",
  cancelled: "danger",
};

export default function TransfersList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "inventory" });
  const { t, lang } = useLang();
  const router = useRouter();
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");

  const transfersParams = { direction };
  const { data, isLoading, refetch, isRefetching } = useGetErpTransfers(transfersParams, {
    query: { enabled: ready, queryKey: getGetErpTransfersQueryKey(transfersParams) },
  });

  if (!ready) return null;
  const canCreate = isAdmin || can("inventory", "create");

  return (
    <RNView style={{ flex: 1 }}>
      <ListScreen
        data={data ?? []}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(tr: any) => String(tr.id)}
        emptyTitle={t("Aucun transfert", "لا توجد تحويلات")}
        header={
          <View style={styles.filterRow}>
            {(["all", "in", "out"] as const).map((d) => (
              <Button
                key={d}
                label={d === "all" ? t("Tous", "الكل") : d === "in" ? t("Entrants", "واردة") : t("Sortants", "صادرة")}
                variant={direction === d ? "primary" : "secondary"}
                onPress={() => setDirection(d)}
                style={styles.filterBtn}
              />
            ))}
          </View>
        }
        renderItem={(tr: any) => (
          <EntityRow
            onPress={() => router.push(`/transfers/${tr.id}` as never)}
            title={`#${tr.id} · ${(lang === "ar" ? tr.sourceStore?.nameAr : tr.sourceStore?.nameEn) ?? "?"} → ${(lang === "ar" ? tr.destinationStore?.nameAr : tr.destinationStore?.nameEn) ?? "?"}`}
            subtitle={`${tr.itemCount ?? 0} ${t("articles", "منتجات")} · ${tr.totalQuantity ?? 0} ${t("unités", "وحدة")}`}
            right={<Badge label={tr.status} tone={STATUS_TONE[tr.status] ?? "muted"} />}
          />
        )}
      />
      {canCreate ? <Fab onPress={() => router.push("/transfers/new" as never)} testID="button-new-transfer" /> : null}
    </RNView>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: "row", gap: 8, padding: 16, backgroundColor: colors.background },
  filterBtn: { flex: 1, paddingVertical: 8 },
});
