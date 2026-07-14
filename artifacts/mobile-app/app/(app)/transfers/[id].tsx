import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useGetErpTransfer, getGetErpTransferQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, LoadingView, SectionTitle, Badge, Divider, ErrorState } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function TransferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready } = useProtectedRoute({ section: "inventory" });
  const { t, lang } = useLang();
  const transferId = Number(id);

  const { data: transfer, isLoading, isError } = useGetErpTransfer(transferId, {
    query: { enabled: ready && !!transferId, queryKey: getGetErpTransferQueryKey(transferId) },
  });

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (isError || !transfer) return <ErrorState title={t("Transfert introuvable", "التحويل غير موجود")} />;

  const tr = transfer as any;
  const items = tr.items ?? [];

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, color: colors.textMuted, marginTop: 8 },
  value: { fontSize: 14, color: colors.text, fontWeight: "500" },
  muted: { fontSize: 13, color: colors.textMuted },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
});
