import React from "react";
import { useGetErpStoresAll, getGetErpStoresAllQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

export default function StoresList() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { t, lang } = useLang();

  const { data, isLoading, refetch, isRefetching } = useGetErpStoresAll({
    query: { enabled: ready, queryKey: getGetErpStoresAllQueryKey() },
  });

  if (!ready) return null;

  return (
    <ListScreen
      data={data ?? []}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(s: any) => String(s.id)}
      emptyTitle={t("Aucun magasin", "لا توجد متاجر")}
      renderItem={(s: any) => (
        <EntityRow
          title={lang === "ar" ? s.nameAr : s.nameEn}
          subtitle={s.address ?? s.slug}
          right={<Badge label={s.isActive ? t("Actif", "نشط") : t("Inactif", "غير نشط")} tone={s.isActive ? "success" : "muted"} />}
        />
      )}
    />
  );
}
