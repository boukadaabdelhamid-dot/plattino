import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useGetPurchaseOrders, getGetPurchaseOrdersQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  pending: "warning",
  ordered: "info",
  received: "success",
  cancelled: "danger",
};

export default function PurchaseOrdersList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "purchases" });
  const { t, lang } = useLang();
  const router = useRouter();
  const currency = lang === "ar" ? "دج" : "DA";

  const poParams = { limit: 50 };
  const { data, isLoading, refetch, isRefetching } = useGetPurchaseOrders(poParams, {
    query: { enabled: ready, queryKey: getGetPurchaseOrdersQueryKey(poParams) },
  });
  const orders = (data as any)?.data ?? [];

  if (!ready) return null;
  const canCreate = isAdmin || can("purchases", "create");

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={orders}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(po: any) => String(po.id)}
        emptyTitle={t("Aucun bon d'achat", "لا توجد أوامر شراء")}
        renderItem={(po: any) => (
          <EntityRow
            onPress={() => router.push(`/purchase-orders/${po.id}` as never)}
            title={`#${po.id}`}
            subtitle={`${Number(po.totalAmount ?? 0).toLocaleString("fr-FR")} ${currency}`}
            right={<Badge label={po.status} tone={STATUS_TONE[po.status] ?? "muted"} />}
          />
        )}
      />
      {canCreate ? <Fab onPress={() => router.push("/purchase-orders/new" as never)} testID="button-new-purchase-order" /> : null}
    </View>
  );
}
