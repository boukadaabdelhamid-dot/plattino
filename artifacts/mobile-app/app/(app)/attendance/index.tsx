import React from "react";
import {
  useGetAttendance,
  useGetEmployees,
  getGetEmployeesQueryKey,
  getGetAttendanceQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted"> = {
  present: "success",
  absent: "danger",
  late: "warning",
};

export default function AttendanceList() {
  const { ready } = useProtectedRoute({ section: "attendance" });
  const { t } = useLang();

  const { data: employees } = useGetEmployees({ query: { enabled: ready, queryKey: getGetEmployeesQueryKey() } });
  const { data, isLoading, refetch, isRefetching } = useGetAttendance(undefined, {
    query: { enabled: ready, queryKey: getGetAttendanceQueryKey() },
  });

  if (!ready) return null;
  const employeeName = (id: number) => (employees ?? []).find((e: any) => e.id === id)?.name ?? `#${id}`;

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(a: any) => String(a.id)}
      emptyTitle={t("Aucune présence enregistrée", "لا يوجد سجل حضور")}
      renderItem={(a: any) => (
        <EntityRow
          title={employeeName(a.employeeId)}
          subtitle={`${a.date} · ${a.checkIn ?? "—"} → ${a.checkOut ?? "—"}`}
          right={<Badge label={a.status} tone={STATUS_TONE[a.status] ?? "muted"} />}
        />
      )}
    />
  );
}
