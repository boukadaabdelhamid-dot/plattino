import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrder,
  getGetOrderQueryKey,
  useUpdateOrderStatus,
  useCreateBonRetour,
  getGetAdminOrdersQueryKey,
  getGetAdminRetoursQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useConfirm } from "@/contexts/confirm-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { getStatusActions } from "@/hooks/use-order-status-actions";
import { Screen } from "@/components/Screen";
import { Card, LoadingView, SectionTitle, Badge, Divider, ErrorState, Button, FormField } from "@/components/ui";
import { SheetModal } from "@/components/SheetModal";
import { QuantityStepper } from "@/components/QuantityStepper";
import { colors } from "@/lib/colors";

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, isAdmin, can } = useProtectedRoute({ section: "orders" });
  const { t, lang, isRTL } = useLang();
  const { confirm } = useConfirm();
  const feedback = useApiFeedback();
  const queryClient = useQueryClient();
  const currency = lang === "ar" ? "دج" : "DA";
  const orderId = Number(id);

  const [retourOpen, setRetourOpen] = useState(false);
  const [retourQty, setRetourQty] = useState<Record<number, number>>({});
  const [retourReason, setRetourReason] = useState("");
  const [retourType, setRetourType] = useState<"remboursement" | "sans_remboursement">("remboursement");

  const { data: order, isLoading, isError } = useGetOrder(orderId, {
    query: { enabled: ready && !!orderId, queryKey: getGetOrderQueryKey(orderId) },
  });
  const updateStatus = useUpdateOrderStatus();
  const createBonRetour = useCreateBonRetour();

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (isError || !order) return <ErrorState title={t("Commande introuvable", "الطلب غير موجود")} />;

  const items = (order as any).items ?? [];
  const canEdit = isAdmin || can("orders", "edit");
  const canCreateRetour = (isAdmin || can("orders", "create")) && !["draft", "cancelled"].includes(order.status);
  const statusActions = getStatusActions(order.status);

  function handleStatusChange(status: string, label: string, labelAr: string, destructive?: boolean) {
    confirm({
      title: t(`Confirmer : ${label}`, `تأكيد: ${labelAr}`),
      titleAr: `تأكيد: ${labelAr}`,
      message: t(`Commande #${order!.id}`, `الطلب #${order!.id}`),
      destructive,
    }).then((ok) => {
      if (!ok) return;
      updateStatus.mutate(
        { id: orderId, data: { status: status as never } },
        {
          onSuccess: () => {
            feedback.success("Statut mis à jour", "تم تحديث الحالة");
            queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
            queryClient.invalidateQueries({ queryKey: getGetAdminOrdersQueryKey() });
          },
          onError: (e) => feedback.error(e),
        },
      );
    });
  }

  function openRetour() {
    const initial: Record<number, number> = {};
    for (const it of items) {
      const pid = it.product?.id;
      if (pid != null) initial[pid] = 0;
    }
    setRetourQty(initial);
    setRetourReason("");
    setRetourType("remboursement");
    setRetourOpen(true);
  }

  function submitRetour() {
    const selected = Object.entries(retourQty)
      .map(([productId, quantity]) => ({ productId: Number(productId), quantity }))
      .filter((l) => l.quantity > 0);
    if (selected.length === 0) {
      feedback.error(null, "Sélectionnez au moins un article", "اختر منتجاً واحداً على الأقل");
      return;
    }
    createBonRetour.mutate(
      { id: orderId, data: { reason: retourReason.trim() || null, retourType, items: selected } },
      {
        onSuccess: () => {
          feedback.success("Retour créé", "تم إنشاء الاسترجاع");
          queryClient.invalidateQueries({ queryKey: getGetAdminRetoursQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          setRetourOpen(false);
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Commande", "الطلب")} #{order.id}</SectionTitle>
        <Badge label={order.status} />
        <Divider />
        <Text style={styles.label}>{t("Client", "العميل")}</Text>
        <Text style={styles.value}>{order.customerName}</Text>
        <Text style={styles.label}>{t("Téléphone", "الهاتف")}</Text>
        <Text style={styles.value}>{order.customerPhone}</Text>
        <Text style={styles.label}>{t("Adresse", "العنوان")}</Text>
        <Text style={styles.value}>{order.customerAddress}</Text>
      </Card>

      <Card>
        <SectionTitle>{t("Articles", "المنتجات")}</SectionTitle>
        {items.length === 0 ? (
          <Text style={styles.muted}>{t("Aucun article", "لا توجد منتجات")}</Text>
        ) : (
          items.map((it: any, i: number) => (
            <View key={it.id ?? i}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.itemRow}>
                <Text style={{ flex: 1 }}>{(lang === "ar" ? it.product?.nameAr : it.product?.nameEn) ?? `#${it.product?.id ?? "?"}`}</Text>
                <Text>x{it.quantity}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Card>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{t("Total", "الإجمالي")}</Text>
          <Text style={styles.totalValue}>{Number(order.totalAmount).toLocaleString("fr-FR")} {currency}</Text>
        </View>
      </Card>

      {canEdit && statusActions.length > 0 ? (
        <Card>
          <SectionTitle>{t("Actions", "الإجراءات")}</SectionTitle>
          <View style={{ gap: 10 }}>
            {statusActions.map((action) => (
              <Button
                key={action.status}
                label={t(action.label, action.labelAr)}
                variant={action.destructive ? "danger" : "primary"}
                onPress={() => handleStatusChange(action.status, action.label, action.labelAr, action.destructive)}
                loading={updateStatus.isPending}
                testID={`button-order-status-${action.status}`}
              />
            ))}
          </View>
        </Card>
      ) : null}

      {canCreateRetour ? (
        <Button
          label={t("Créer un retour", "إنشاء استرجاع")}
          variant="secondary"
          onPress={openRetour}
          testID="button-open-retour"
        />
      ) : null}

      <SheetModal
        visible={retourOpen}
        onClose={() => setRetourOpen(false)}
        title={t("Nouveau retour", "استرجاع جديد")}
        footer={
          <Button
            label={t("Créer le retour", "إنشاء الاسترجاع")}
            onPress={submitRetour}
            loading={createBonRetour.isPending}
            testID="button-submit-order-retour"
          />
        }
      >
        {items
          .filter((it: any) => it.product?.id != null)
          .map((it: any, i: number) => (
            <View key={it.product.id}>
              {i > 0 ? <Divider /> : null}
              <View style={[styles.retourRow, isRTL && styles.retourRowRTL]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cartName} numberOfLines={1}>
                    {(lang === "ar" ? it.product?.nameAr : it.product?.nameEn) ?? `#${it.product.id}`}
                  </Text>
                  <Text style={styles.cartSub}>{t(`Commandé: ${it.quantity}`, `المطلوب: ${it.quantity}`)}</Text>
                </View>
                <QuantityStepper
                  value={retourQty[it.product.id] ?? 0}
                  min={0}
                  max={it.quantity}
                  onChange={(q) => setRetourQty((prev) => ({ ...prev, [it.product.id]: q }))}
                />
              </View>
            </View>
          ))}
        <Divider />
        <View style={[styles.paymentRow, isRTL && styles.retourRowRTL]}>
          <Button
            label={t("Remboursement", "استرداد")}
            variant={retourType === "remboursement" ? "primary" : "secondary"}
            onPress={() => setRetourType("remboursement")}
            style={{ flex: 1 }}
            testID="button-order-retour-type-remboursement"
          />
          <Button
            label={t("Sans remboursement", "بدون استرداد")}
            variant={retourType === "sans_remboursement" ? "primary" : "secondary"}
            onPress={() => setRetourType("sans_remboursement")}
            style={{ flex: 1 }}
            testID="button-order-retour-type-sans-remboursement"
          />
        </View>
        <FormField label={t("Motif", "السبب")} value={retourReason} onChangeText={setRetourReason} multiline />
      </SheetModal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, color: colors.textMuted, marginTop: 8 },
  value: { fontSize: 14, color: colors.text, fontWeight: "500" },
  muted: { fontSize: 13, color: colors.textMuted },
  itemRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  totalValue: { fontSize: 18, fontWeight: "700", color: colors.primary },
  retourRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  retourRowRTL: { flexDirection: "row-reverse" },
  cartName: { fontSize: 14, fontWeight: "600", color: colors.text },
  cartSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  paymentRow: { flexDirection: "row", gap: 10, marginVertical: 10 },
});
