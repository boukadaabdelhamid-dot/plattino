import React from "react";
import { useGetEmployees, getGetEmployeesQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

export default function EmployeesList() {
  const { ready } = useProtectedRoute({ section: "employees" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data, isLoading, refetch, isRefetching } = useGetEmployees({
    query: { enabled: ready, queryKey: getGetEmployeesQueryKey() },
  });

  if (!ready) return null;

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(e: any) => String(e.id)}
      emptyTitle={t("Aucun employé", "لا يوجد موظفون")}
      renderItem={(e: any) => (
        <EntityRow
          title={e.name}
          subtitle={`${e.position} · ${Number(e.salary).toLocaleString("fr-FR")} ${currency}`}
          right={<Badge label={e.status} tone={e.status === "active" ? "success" : "muted"} />}
        />
      )}
    />
  );
}
