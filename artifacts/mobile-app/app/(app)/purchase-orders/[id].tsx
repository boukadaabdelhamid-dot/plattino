import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPurchaseOrderItems,
  useGetPurchaseOrders,
  useReceivePurchaseOrder,
  getGetPurchaseOrdersQueryKey,
  getGetPurchaseOrderItemsQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useConfirm } from "@/contexts/confirm-context";
import { Screen } from "@/components/Screen";
import { Card, Button, LoadingView, SectionTitle, Badge, Divider, ErrorState } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function PurchaseOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, isAdmin, can } = useProtectedRoute({ section: "purchases" });
  const { t, lang } = useLang();
  const router = useRouter();
  const feedback = useApiFeedback();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const currency = lang === "ar" ? "دج" : "DA";
  const poId = Number(id);

  const poListParams = { limit: 200 };
  const { data: list, isLoading } = useGetPurchaseOrders(poListParams, {
    query: { enabled: ready, queryKey: getGetPurchaseOrdersQueryKey(poListParams) },
  });
  const po = ((list as any)?.data ?? []).find((p: any) => p.id === poId);
  const { data: items } = useGetPurchaseOrderItems(poId, {
    query: { enabled: ready && !!poId, queryKey: getGetPurchaseOrderItemsQueryKey(poId) },
  });
  const receivePO = useReceivePurchaseOrder();

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (!po) return <ErrorState title={t("Bon d'achat introuvable", "أمر الشراء غير موجود")} />;

  const canEdit = isAdmin || can("purchases", "edit");
  const canReceive = po.status === "pending" && canEdit;

  async function handleReceive() {
    const ok = await confirm({
      title: t("Confirmer la réception ?", "تأكيد الاستلام؟"),
      message: t("Le stock sera mis à jour et la dette fournisseur créée si applicable.", "سيتم تحديث المخزون وإنشاء دين المورد إن وجد."),
    });
    if (!ok) return;
    receivePO.mutate(
      { id: poId },
      {
        onSuccess: () => {
          feedback.success("Bon d'achat reçu", "تم استلام أمر الشراء");
          queryClient.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey(poListParams) });
          queryClient.invalidateQueries({ queryKey: getGetPurchaseOrderItemsQueryKey(poId) });
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Bon d'achat", "أمر الشراء")} #{po.id}</SectionTitle>
        <Badge label={po.status} />
        {po.notes ? (
          <>
            <Divider />
            <Text style={styles.notes}>{po.notes}</Text>
          </>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t("Articles", "المنتجات")}</SectionTitle>
        {!items || (items as any[]).length === 0 ? (
          <Text style={styles.muted}>{t("Aucun article", "لا توجد منتجات")}</Text>
        ) : (
          (items as any[]).map((it, i) => (
            <View key={it.id ?? i}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <Text style={{ flex: 1 }} numberOfLines={1}>{it.productNameEn ?? it.productNameAr ?? `#${it.productId}`}</Text>
                <Text>{it.quantity} × {Number(it.unitCost).toLocaleString("fr-FR")} {currency}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t("Total", "الإجمالي")}</Text>
          <Text style={styles.totalValue}>{Number(po.totalAmount ?? 0).toLocaleString("fr-FR")} {currency}</Text>
        </View>
      </Card>

      {po.status === "pending" && canEdit ? (
        <Button
          label={t("Modifier", "تعديل")}
          variant="secondary"
          onPress={() => router.push(`/purchase-orders/${poId}/edit` as never)}
          testID="button-edit-purchase-order"
        />
      ) : null}
      {canReceive ? (
        <Button
          label={t("Marquer comme reçu", "وضع علامة تم الاستلام")}
          onPress={handleReceive}
          loading={receivePO.isPending}
          testID="button-receive-purchase-order"
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  notes: { fontSize: 13, color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, gap: 8 },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  totalValue: { fontSize: 18, fontWeight: "700", color: colors.primary },
});
