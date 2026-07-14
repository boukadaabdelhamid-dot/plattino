import React from "react";
import { useGetAdminRetours, getGetAdminRetoursQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

export default function RetoursList() {
  const { ready } = useProtectedRoute({ section: "orders" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data, isLoading, refetch, isRefetching } = useGetAdminRetours({
    query: { enabled: ready, queryKey: getGetAdminRetoursQueryKey() },
  });

  if (!ready) return null;

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(r: any) => String(r.id)}
      emptyTitle={t("Aucun retour", "لا توجد مرتجعات")}
      renderItem={(r: any) => (
        <EntityRow
          title={`#${r.id} · ${r.orderId ? `Commande #${r.orderId}` : ""}`}
          subtitle={`${Number(r.totalAmount ?? r.refundAmount ?? 0).toLocaleString("fr-FR")} ${currency}`}
          right={<Badge label={r.status ?? "—"} />}
        />
      )}
    />
  );
}
