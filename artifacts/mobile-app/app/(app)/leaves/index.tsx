import React from "react";
import {
  useGetLeaves,
  useGetEmployees,
  getGetEmployeesQueryKey,
  getGetLeavesQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted"> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
};

export default function LeavesList() {
  const { ready } = useProtectedRoute({ section: "leaves" });
  const { t } = useLang();

  const { data: employees } = useGetEmployees({ query: { enabled: ready, queryKey: getGetEmployeesQueryKey() } });
  const { data, isLoading, refetch, isRefetching } = useGetLeaves({
    query: { enabled: ready, queryKey: getGetLeavesQueryKey() },
  });

  if (!ready) return null;
  const employeeName = (id: number) => (employees ?? []).find((e: any) => e.id === id)?.name ?? `#${id}`;

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(l: any) => String(l.id)}
      emptyTitle={t("Aucune demande de congé", "لا توجد طلبات إجازة")}
      renderItem={(l: any) => (
        <EntityRow
          title={employeeName(l.employeeId)}
          subtitle={`${l.type} · ${l.startDate} → ${l.endDate}`}
          right={<Badge label={l.status} tone={STATUS_TONE[l.status] ?? "muted"} />}
        />
      )}
    />
  );
}
