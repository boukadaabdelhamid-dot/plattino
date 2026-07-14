import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useGetSuppliers, getGetSuppliersQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen, SearchBar } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";

export default function SuppliersList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "suppliers" });
  const { t, lang } = useLang();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const currency = lang === "ar" ? "دج" : "DA";

  const suppliersParams = { search: search || undefined, limit: 50 };
  const { data, isLoading, refetch, isRefetching } = useGetSuppliers(suppliersParams, {
    query: { enabled: ready, queryKey: getGetSuppliersQueryKey(suppliersParams) },
  });
  const suppliers = (data as any)?.data ?? [];

  if (!ready) return null;
  const canCreate = isAdmin || can("suppliers", "create");

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={suppliers}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(s: any) => String(s.id)}
        emptyTitle={t("Aucun fournisseur", "لا يوجد موردون")}
        header={<SearchBar value={search} onChangeText={setSearch} placeholder={t("Rechercher...", "بحث...")} />}
        renderItem={(s: any) => (
          <EntityRow
            onPress={() => router.push(`/suppliers/${s.id}` as never)}
            title={s.name}
            subtitle={s.phone ?? s.email ?? ""}
            right={
              <Badge
                label={`${Number(s.currentBalance ?? 0).toLocaleString("fr-FR")} ${currency}`}
                tone={Number(s.currentBalance) > 0 ? "danger" : "success"}
              />
            }
          />
        )}
      />
      {canCreate ? <Fab onPress={() => router.push("/suppliers/new" as never)} testID="button-new-supplier" /> : null}
    </View>
  );
}
