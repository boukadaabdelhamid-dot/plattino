import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useConfirm } from "@/contexts/confirm-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { ListScreen, SearchBar } from "@/components/ListScreen";
import { EntityRow } from "@/components/EntityRow";
import { Badge, Button, Card } from "@/components/ui";
import { Fab } from "@/components/Fab";
import { getActiveBaseUrl } from "@/lib/api";
import { getToken } from "@/lib/auth-storage";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "muted" | "info"> = {
  pending: "warning",
  processing: "warning",
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
  const res = await fetch(`${getActiveBaseUrl()}/api/erp/sale-orders?${params}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { data: SaleOrderRow[] };
  return json.data ?? [];
}

async function clotureOrder(id: number): Promise<void> {
  const token = getToken();
  const res = await fetch(`${getActiveBaseUrl()}/api/erp/sale-orders/${id}/cloture`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `HTTP ${res.status}`);
  }
}

/**
 * Unified sale history: bons de vente (order_source='bon') +
 * ventes rapides (order_source='pos'), sorted by date desc.
 */
export default function SaleOrdersList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "orders" });
  const { t, lang } = useLang();
  const router = useRouter();
  const { confirm } = useConfirm();
  const feedback = useApiFeedback();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [cloturingId, setCloturingId] = useState<number | null>(null);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["erp-sale-orders-mobile", search],
    queryFn: () => fetchSaleOrders(search || undefined),
    enabled: ready,
  });

  const orders = data ?? [];

  if (!ready) return null;
  const canCreate = isAdmin || can("orders", "create");
  const canEdit = isAdmin || can("orders", "edit");
  const currency = lang === "ar" ? "دج" : "DA";

  async function handleCloture(order: SaleOrderRow) {
    const prefix = order.order_source === "pos" ? "VR" : "BV";
    const ref = `${prefix}-${String(order.id).padStart(5, "0")}`;
    const ok = await confirm({
      title: t(`Clôturer ${ref} ?`, `إغلاق ${ref}؟`),
      message: t(
        "Le stock sera déduit et le paiement enregistré.",
        "سيتم خصم المخزون وتسجيل الدفع."
      ),
    });
    if (!ok) return;
    setCloturingId(order.id);
    try {
      await clotureOrder(order.id);
      feedback.success("Bon clôturé", "تم إغلاق البون");
      queryClient.invalidateQueries({ queryKey: ["erp-sale-orders-mobile"] });
      refetch();
    } catch (e: any) {
      feedback.error(e);
    } finally {
      setCloturingId(null);
    }
  }

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
        renderItem={(o) => {
          const isActive = o.status === "pending" || o.status === "processing";
          const prefix = o.order_source === "pos" ? "VR" : "BV";
          return (
            <Card style={styles.card}>
              <EntityRow
                onPress={() => router.push(`/orders/${o.id}` as never)}
                title={`${prefix}-${String(o.id).padStart(5, "0")} · ${o.customer_name}`}
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
              {canEdit && isActive ? (
                <View style={styles.actionsRow}>
                  <Button
                    label={t("Clôturer", "إغلاق")}
                    onPress={() => handleCloture(o)}
                    loading={cloturingId === o.id}
                    style={{ flex: 1 }}
                    testID={`button-cloture-${o.id}`}
                  />
                </View>
              ) : null}
            </Card>
          );
        }}
      />
      {canCreate ? <Fab onPress={() => router.push("/orders/new" as never)} testID="button-new-sale-order" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 4,
    padding: 0,
    overflow: "hidden",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    paddingTop: 0,
  },
});
