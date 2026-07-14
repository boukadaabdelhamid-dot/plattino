import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useGetAdminOrders, getGetAdminOrdersQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen, SearchBar } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  pending: "warning",
  confirmed: "info",
  delivered: "success",
  cancelled: "danger",
};

/**
 * "Bons de vente" mirrors the same order records as /orders (the web ERP's
 * POS-generated sale slips), filtered to in-store sales (sellerUserId set).
 */
export default function SaleOrdersList() {
  const { ready } = useProtectedRoute({ section: "orders" });
  const { t, lang } = useLang();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch, isRefetching } = useGetAdminOrders(undefined, {
    query: { enabled: ready, queryKey: getGetAdminOrdersQueryKey() },
  });
  const filtered = (data ?? [])
    .filter((o) => o.sellerUserId != null)
    .filter((o) => !search || o.customerName.toLowerCase().includes(search.toLowerCase()) || String(o.id).includes(search));

  if (!ready) return null;

  return (
    <ListScreen
      data={filtered}
      isLoading={isLoading}
      onRefresh={refetch}
      refreshing={isRefetching}
      keyExtractor={(o) => String(o.id)}
      emptyTitle={t("Aucun bon de vente", "لا توجد فواتير بيع")}
      header={<SearchBar value={search} onChangeText={setSearch} placeholder={t("Rechercher...", "بحث...")} />}
      renderItem={(o) => (
        <EntityRow
          onPress={() => router.push(`/orders/${o.id}` as never)}
          title={`#${o.id} · ${o.customerName}`}
          subtitle={`${Number(o.totalAmount).toLocaleString("fr-FR")} ${lang === "ar" ? "دج" : "DA"}`}
          right={<Badge label={o.status} tone={STATUS_TONE[o.status] ?? "muted"} />}
        />
      )}
    />
  );
}
