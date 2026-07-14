import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useGetAdminRetours, getGetAdminRetoursQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";

export default function RetoursList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "orders" });
  const { t, lang } = useLang();
  const router = useRouter();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data, isLoading, refetch, isRefetching } = useGetAdminRetours({
    query: { enabled: ready, queryKey: getGetAdminRetoursQueryKey() },
  });

  if (!ready) return null;
  const canCreate = isAdmin || can("orders", "create");

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={data ?? []}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(r: any) => String(r.id)}
        emptyTitle={t("Aucun retour", "لا توجد مرتجعات")}
        renderItem={(r: any) => (
          <EntityRow
            title={`#${r.id} · ${r.originalOrderId ? `Commande #${r.originalOrderId}` : r.clientName ?? ""}`}
            subtitle={`${Number(r.totalAmount ?? 0).toLocaleString("fr-FR")} ${currency}`}
            right={<Badge label={r.retourType ?? "—"} />}
          />
        )}
      />
      {canCreate ? <Fab onPress={() => router.push("/retours/new" as never)} testID="button-new-retour" /> : null}
    </View>
  );
}
