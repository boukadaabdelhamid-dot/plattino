import React from "react";
import { useGetErpStaff, getGetErpStaffQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

export default function SettingsStaff() {
  const { ready } = useProtectedRoute({ section: "settings" });
  const { t } = useLang();

  const { data, isLoading, refetch, isRefetching } = useGetErpStaff({
    query: { enabled: ready, queryKey: getGetErpStaffQueryKey() },
  });

  if (!ready) return null;

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(s: any) => String(s.id)}
      emptyTitle={t("Aucun membre du personnel", "لا يوجد موظفون")}
      renderItem={(s: any) => <EntityRow title={s.name} subtitle={s.email} right={<Badge label={s.role} />} />}
    />
  );
}
