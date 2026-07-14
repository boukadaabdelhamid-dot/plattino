import React from "react";
import { useRouter } from "expo-router";
import { useGetErpStaff, getGetErpStaffQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

/** Staff list — tap a member to edit their section/action permissions. */
export default function Permissions() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { t } = useLang();
  const router = useRouter();

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
      renderItem={(s: any) => (
        <EntityRow
          title={s.name}
          subtitle={s.email}
          right={
            s.role === "admin" ? (
              <Badge label={t("Administrateur", "مدير")} tone="info" />
            ) : undefined
          }
          onPress={() => router.push(`/permissions/${s.id}` as never)}
        />
      )}
    />
  );
}
