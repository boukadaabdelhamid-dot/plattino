import React from "react";
import { useGetInventoryMovements, getGetInventoryMovementsQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

const TYPE_TONE: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  in: "success",
  out: "danger",
  adjustment: "warning",
};

export default function InventoryList() {
  const { ready } = useProtectedRoute({ section: "inventory" });
  const { t } = useLang();

  const { data, isLoading, refetch, isRefetching } = useGetInventoryMovements({
    query: { enabled: ready, queryKey: getGetInventoryMovementsQueryKey() },
  });

  if (!ready) return null;

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(m: any) => String(m.id)}
      emptyTitle={t("Aucun mouvement de stock", "لا توجد حركات مخزون")}
      renderItem={(m: any) => (
        <EntityRow
          title={m.product?.nameEn ?? m.product?.nameAr ?? `#${m.productId}`}
          subtitle={`${m.reason ?? m.reference ?? ""}`}
          right={<Badge label={`${m.type} · ${m.quantity}`} tone={TYPE_TONE[m.type] ?? "muted"} />}
        />
      )}
    />
  );
}
