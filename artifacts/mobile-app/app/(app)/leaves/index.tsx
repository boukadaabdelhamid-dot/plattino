import React from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetLeaves,
  useGetEmployees,
  useUpdateLeaveStatus,
  getGetEmployeesQueryKey,
  getGetLeavesQueryKey,
  UpdateLeaveStatusBodyStatus,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useConfirm } from "@/contexts/confirm-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge, Button, Card } from "@/components/ui";
import { Fab } from "@/components/Fab";
import { colors } from "@/lib/colors";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted"> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
};

export default function LeavesList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "leaves" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const { confirm } = useConfirm();

  const { data: employees } = useGetEmployees({ query: { enabled: ready, queryKey: getGetEmployeesQueryKey() } });
  const { data, isLoading, refetch, isRefetching } = useGetLeaves({
    query: { enabled: ready, queryKey: getGetLeavesQueryKey() },
  });
  const updateStatus = useUpdateLeaveStatus();

  if (!ready) return null;
  const employeeName = (id: number) => (employees ?? []).find((e: any) => e.id === id)?.name ?? `#${id}`;
  const canCreate = isAdmin || can("leaves", "create");
  const canEdit = isAdmin || can("leaves", "edit");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetLeavesQueryKey() });
    refetch();
  }

  function handleApprove(id: number) {
    updateStatus.mutate(
      { id, data: { status: UpdateLeaveStatusBodyStatus.approved } },
      {
        onSuccess: () => {
          feedback.success("Congé approuvé", "تمت الموافقة على الإجازة");
          invalidate();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  async function handleReject(id: number) {
    const ok = await confirm({
      title: t("Rejeter la demande", "رفض الطلب"),
      message: t("Cette demande de congé sera rejetée.", "سيتم رفض طلب الإجازة هذا."),
      destructive: true,
    });
    if (!ok) return;
    updateStatus.mutate(
      { id, data: { status: UpdateLeaveStatusBodyStatus.rejected } },
      {
        onSuccess: () => {
          feedback.success("Congé rejeté", "تم رفض الإجازة");
          invalidate();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={data ?? []}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(l: any) => String(l.id)}
        emptyTitle={t("Aucune demande de congé", "لا توجد طلبات إجازة")}
        renderItem={(l: any) => (
          <Card style={styles.card}>
            <EntityRow
              title={employeeName(l.employeeId)}
              subtitle={`${l.type} · ${l.startDate} → ${l.endDate}`}
              right={<Badge label={l.status} tone={STATUS_TONE[l.status] ?? "muted"} />}
            />
            {canEdit && l.status === "pending" ? (
              <View style={styles.actionsRow}>
                <Button
                  label={t("Approuver", "قبول")}
                  onPress={() => handleApprove(l.id)}
                  loading={updateStatus.isPending}
                  style={{ flex: 1 }}
                  testID={`button-approve-${l.id}`}
                />
                <Button
                  label={t("Rejeter", "رفض")}
                  variant="danger"
                  onPress={() => handleReject(l.id)}
                  loading={updateStatus.isPending}
                  style={{ flex: 1 }}
                  testID={`button-reject-${l.id}`}
                />
              </View>
            ) : null}
          </Card>
        )}
      />
      {canCreate ? <Fab onPress={() => router.push("/leaves/new" as never)} testID="button-new-leave" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16, marginTop: 12, paddingVertical: 4, gap: 4 },
  actionsRow: { flexDirection: "row", gap: 8, marginTop: 8, paddingHorizontal: 16, paddingBottom: 8 },
});
