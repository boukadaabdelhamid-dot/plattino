import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useGetErpCustomers, getGetErpCustomersQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen, SearchBar } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

export default function CustomersList() {
  const { ready } = useProtectedRoute({ section: "customers" });
  const { t, lang } = useLang();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const currency = lang === "ar" ? "دج" : "DA";

  const customersParams = { search: search || undefined, limit: 50 };
  const { data, isLoading, refetch, isRefetching } = useGetErpCustomers(customersParams, {
    query: { enabled: ready, queryKey: getGetErpCustomersQueryKey(customersParams) },
  });
  const customers = (data as any)?.data ?? [];

  if (!ready) return null;

  return (
    <ListScreen
      data={customers}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(c: any) => String(c.id)}
      emptyTitle={t("Aucun client", "لا يوجد عملاء")}
      header={<SearchBar value={search} onChangeText={setSearch} placeholder={t("Rechercher un client...", "بحث عن عميل...")} />}
      renderItem={(c: any) => (
        <EntityRow
          onPress={() => router.push(`/customers/${c.id}` as never)}
          title={c.name}
          subtitle={c.phone ?? c.email ?? ""}
          right={
            Number(c.currentBalance ?? 0) !== 0 ? (
              <Badge
                label={`${Number(c.currentBalance).toLocaleString("fr-FR")} ${currency}`}
                tone={Number(c.currentBalance) < 0 ? "danger" : "success"}
              />
            ) : undefined
          }
        />
      )}
    />
  );
}
