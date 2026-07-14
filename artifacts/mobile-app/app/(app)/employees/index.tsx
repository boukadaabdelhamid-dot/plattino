import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useGetEmployees, getGetEmployeesQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";

const STATUS_TONE: Record<string, "success" | "warning" | "muted"> = {
  active: "success",
  on_leave: "warning",
  inactive: "muted",
};

export default function EmployeesList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "employees" });
  const { t, lang } = useLang();
  const router = useRouter();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data, isLoading, refetch, isRefetching } = useGetEmployees({
    query: { enabled: ready, queryKey: getGetEmployeesQueryKey() },
  });

  if (!ready) return null;
  const canCreate = isAdmin || can("employees", "create");
  const canEdit = isAdmin || can("employees", "edit");

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={data ?? []}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(e: any) => String(e.id)}
        emptyTitle={t("Aucun employé", "لا يوجد موظفون")}
        renderItem={(e: any) => (
          <EntityRow
            onPress={canEdit ? () => router.push(`/employees/${e.id}/edit` as never) : undefined}
            title={e.name}
            subtitle={`${e.position} · ${Number(e.salary).toLocaleString("fr-FR")} ${currency}`}
            right={<Badge label={e.status} tone={STATUS_TONE[e.status] ?? "muted"} />}
          />
        )}
      />
      {canCreate ? <Fab onPress={() => router.push("/employees/new" as never)} testID="button-new-employee" /> : null}
    </View>
  );
}
