import React from "react";
import { Text, StyleSheet } from "react-native";
import { useGetErpStaff, getGetErpStaffQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { colors } from "@/lib/colors";

/**
 * Read-only overview of staff and roles. Editing per-section grants is a
 * dense desktop-table workflow (web ERP's Permissions page) that we surface
 * as a follow-up rather than replicate on a small screen.
 */
export default function Permissions() {
  const { ready } = useProtectedRoute({ adminOnly: true });
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
      header={
        <Text style={styles.hint}>
          {t("Gestion détaillée des permissions disponible sur le web.", "إدارة الصلاحيات التفصيلية متوفرة على الويب.")}
        </Text>
      }
      renderItem={(s: any) => <EntityRow title={s.name} subtitle={s.role} />}
    />
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12.5, color: colors.textMuted, marginHorizontal: 16, marginTop: 16, marginBottom: 4 },
});
