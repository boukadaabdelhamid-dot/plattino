import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetErpTransfer,
  getGetErpTransferQueryKey,
  getGetErpTransfersQueryKey,
  useApproveErpTransfer,
  useRejectErpTransfer,
  usePrepareErpTransfer,
  useShipErpTransfer,
  useReceiveErpTransfer,
  useCancelErpTransfer,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useStoreContext } from "@/contexts/store-context";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useConfirm } from "@/contexts/confirm-context";
import { Screen } from "@/components/Screen";
import { Card, Button, LoadingView, SectionTitle, Badge, Divider, ErrorState } from "@/components/ui";
import { getTransferActions, type TransferAction } from "@/hooks/use-transfer-status-actions";
import { colors } from "@/lib/colors";

export default function TransferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, isAdmin } = useProtectedRoute({ section: "inventory" });
  const { currentStoreId } = useStoreContext();
  const { t, lang } = useLang();
  const feedback = useApiFeedback();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const transferId = Number(id);

  const { data: transfer, isLoading, isError } = useGetErpTransfer(transferId, {
    query: { enabled: ready && !!transferId, queryKey: getGetErpTransferQueryKey(transferId) },
  });

  const approve = useApproveErpTransfer();
  const reject = useRejectErpTransfer();
  const prepare = usePrepareErpTransfer();
  const ship = useShipErpTransfer();
  const receive = useReceiveErpTransfer();
  const cancel = useCancelErpTransfer();

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (isError || !transfer) return <ErrorState title={t("Transfert introuvable", "التحويل غير موجود")} />;

  const tr = transfer as any;
  const items = tr.items ?? [];

  const isSource = tr.sourceStoreId === currentStoreId;
  const isDestination = tr.destinationStoreId === currentStoreId;
  const actions = getTransferActions(tr.status, { isSource, isDestination, isAdmin });

  const mutations: Record<TransferAction, { mutate: (vars: any, opts?: any) => void; isPending: boolean }> = {
    approve, reject, prepare, ship, receive, cancel,
  };

  async function handleAction(action: TransferAction, destructive?: boolean, label?: string) {
    if (destructive) {
      const ok = await confirm({
        title: label ?? t("Confirmer", "تأكيد"),
        message: t("Cette action est irréversible.", "هذا الإجراء لا يمكن التراجع عنه."),
        destructive: true,
      });
      if (!ok) return;
    }
    mutations[action].mutate(
      { id: transferId, data: {} },
      {
        onSuccess: () => {
          feedback.success("Transfert mis à jour", "تم تحديث التحويل");
          queryClient.invalidateQueries({ queryKey: getGetErpTransferQueryKey(transferId) });
          queryClient.invalidateQueries({ queryKey: getGetErpTransfersQueryKey() });
        },
        onError: (e: unknown) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Transfert", "التحويل")} #{tr.id}</SectionTitle>
        <Badge label={tr.status} />
        <Divider />
        <Text style={styles.label}>{t("De", "من")}</Text>
        <Text style={styles.value}>{(lang === "ar" ? tr.sourceStore?.nameAr : tr.sourceStore?.nameEn) ?? "—"}</Text>
        <Text style={styles.label}>{t("Vers", "إلى")}</Text>
        <Text style={styles.value}>{(lang === "ar" ? tr.destinationStore?.nameAr : tr.destinationStore?.nameEn) ?? "—"}</Text>
        {tr.notes ? (
          <>
            <Text style={styles.label}>{t("Notes", "ملاحظات")}</Text>
            <Text style={styles.value}>{tr.notes}</Text>
          </>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>{t("Articles", "المنتجات")}</SectionTitle>
        {items.length === 0 ? (
          <Text style={styles.muted}>{t("Aucun article", "لا توجد منتجات")}</Text>
        ) : (
          items.map((it: any, i: number) => (
            <View key={it.id ?? i}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <Text style={{ flex: 1 }}>{it.product?.nameEn ?? it.product?.nameAr ?? `#${it.productId}`}</Text>
                <Text>x{it.quantity}</Text>
              </View>
            </View>
          ))
        )}
      </Card>

      {actions.length > 0 ? (
        <Card>
          <SectionTitle>{t("Actions", "الإجراءات")}</SectionTitle>
          <View style={{ gap: 10 }}>
            {actions.map((a) => (
              <Button
                key={a.action}
                label={t(a.label, a.labelAr)}
                variant={a.destructive ? "danger" : "primary"}
                loading={mutations[a.action].isPending}
                onPress={() => handleAction(a.action, a.destructive, t(a.label, a.labelAr))}
                testID={`button-transfer-${a.action}`}
              />
            ))}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, color: colors.textMuted, marginTop: 8 },
  value: { fontSize: 14, color: colors.text, fontWeight: "500" },
  muted: { fontSize: 13, color: colors.textMuted },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
});
