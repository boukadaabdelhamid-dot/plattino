import React from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
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
import { Badge, Button } from "@/components/ui";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted"> = {
  present: "success",
  absent: "danger",
  late: "warning",
};

export default function AttendanceList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "attendance" });
  const { t } = useLang();
  const router = useRouter();

  const { data: employees } = useGetEmployees({ query: { enabled: ready, queryKey: getGetEmployeesQueryKey() } });
  const { data, isLoading, refetch, isRefetching } = useGetAttendance(undefined, {
    query: { enabled: ready, queryKey: getGetAttendanceQueryKey() },
  });

  if (!ready) return null;
  const employeeName = (id: number) => (employees ?? []).find((e: any) => e.id === id)?.name ?? `#${id}`;
  const canCreate = isAdmin || can("attendance", "create");

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(a: any) => String(a.id)}
      emptyTitle={t("Aucune présence enregistrée", "لا يوجد سجل حضور")}
      header={
        canCreate ? (
          <View style={styles.actionsRow}>
            <Button
              label={t("Pointer une entrée", "تسجيل دخول")}
              onPress={() => router.push("/attendance/new?mode=in" as never)}
              style={{ flex: 1 }}
              testID="button-check-in"
            />
            <Button
              label={t("Pointer une sortie", "تسجيل خروج")}
              variant="secondary"
              onPress={() => router.push("/attendance/new?mode=out" as never)}
              style={{ flex: 1 }}
              testID="button-check-out"
            />
          </View>
        ) : undefined
      }
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

const styles = StyleSheet.create({
  actionsRow: { flexDirection: "row", gap: 8, padding: 16, paddingBottom: 4 },
});
