import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useGetErpStaff, getGetErpStaffQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";

export default function StaffList() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { t } = useLang();
  const router = useRouter();

  const { data, isLoading, refetch, isRefetching } = useGetErpStaff({
    query: { enabled: ready, queryKey: getGetErpStaffQueryKey() },
  });

  if (!ready) return null;

  return (
    <View style={{ flex: 1 }}>
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
            right={<Badge label={s.role === "admin" ? t("Admin", "مدير") : t("Employé", "موظف")} tone={s.role === "admin" ? "info" : "muted"} />}
            onPress={() => router.push(`/staff/${s.id}` as never)}
          />
        )}
      />
      <Fab onPress={() => router.push("/staff/new" as never)} testID="button-new-staff" />
    </View>
  );
}
