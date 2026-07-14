import React from "react";
import { useGetErpCaisseReports, getGetErpCaisseReportsQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";

export default function CaisseReports() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data, isLoading, refetch, isRefetching } = useGetErpCaisseReports(undefined, {
    query: { enabled: ready, queryKey: getGetErpCaisseReportsQueryKey() },
  });

  if (!ready) return null;

  const rows = data?.rows ?? [];

  return (
    <ListScreen
      data={rows}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(r: any) => String(r.caisseId)}
      emptyTitle={t("Aucun rapport", "لا توجد تقارير")}
      renderItem={(r: any) => (
        <EntityRow
          title={r.caisseName ?? r.label ?? "—"}
          subtitle={`${t("Mouvement net", "الحركة الصافية")}: ${Number(r.netMovement ?? 0).toLocaleString("fr-FR")} ${currency}`}
        />
      )}
    />
  );
}
