import React, { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen, SearchBar } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";
import { API_BASE_URL } from "@/lib/api";
import { getToken } from "@/lib/auth-storage";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  pending: "warning",
  confirmed: "info",
  delivered: "success",
  cancelled: "danger",
};

type SaleOrderRow = {
  id: number;
  status: string;
  order_source: "bon" | "pos";
  customer_name: string;
  customer_phone: string;
  total_amount: string;
  created_at: string;
};

async function fetchSaleOrders(search?: string): Promise<SaleOrderRow[]> {
  const token = getToken();
  const params = new URLSearchParams({ limit: "200" });
  if (search) params.set("search", search);
  const res = await fetch(`${API_BASE_URL}/api/erp/sale-orders?${params}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { data: SaleOrderRow[] };
  return json.data ?? [];
}

/**
 * Unified sale history: bons de vente (order_source='bon') +
 * ventes rapides (order_source='pos'), sorted by date desc.
 */
export default function SaleOrdersList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "orders" });
  const { t, lang } = useLang();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["erp-sale-orders-mobile", search],
    queryFn: () => fetchSaleOrders(search || undefined),
    enabled: ready,
  });

  const orders = data ?? [];

  if (!ready) return null;
  const canCreate = isAdmin || can("orders", "create");
  const currency = lang === "ar" ? "دج" : "DA";

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={orders}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(o) => String(o.id)}
        emptyTitle={t("Aucune vente", "لا توجد مبيعات")}
        header={<SearchBar value={search} onChangeText={setSearch} placeholder={t("Rechercher...", "بحث...")} />}
        renderItem={(o) => (
          <EntityRow
            onPress={() => router.push(`/orders/${o.id}` as never)}
            title={`${o.order_source === "pos" ? "VR" : "BV"}-${String(o.id).padStart(5, "0")} · ${o.customer_name}`}
            subtitle={`${Number(o.total_amount).toLocaleString("fr-FR")} ${currency}`}
            right={
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Badge
                  label={o.order_source === "pos" ? t("Rapide", "سريع") : t("Bon", "بون")}
                  tone={o.order_source === "pos" ? "info" : "muted"}
                />
                <Badge label={o.status} tone={STATUS_TONE[o.status] ?? "muted"} />
              </View>
            }
          />
        )}
      />
      {canCreate ? <Fab onPress={() => router.push("/orders/new" as never)} testID="button-new-sale-order" /> : null}
    </View>
  );
}
