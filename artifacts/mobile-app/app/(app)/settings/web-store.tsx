import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useGetErpStoresMine, getGetErpStoresMineQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle, LoadingView } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function WebStoreSettings() {
  const { ready } = useProtectedRoute({ adminOnly: true, section: "settings" });
  const { t, lang } = useLang();

  const { data: stores, isLoading } = useGetErpStoresMine({
    query: { enabled: ready, queryKey: getGetErpStoresMineQueryKey() },
  });
  const store = stores?.[0];

  if (!ready) return null;
  if (isLoading) return <LoadingView />;

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Boutique en ligne", "المتجر الإلكتروني")}</SectionTitle>
        <Row label={t("Nom", "الاسم")} value={(lang === "ar" ? store?.nameAr : store?.nameEn) ?? "—"} />
        <Row label={t("Adresse", "العنوان")} value={store?.address ?? "—"} />
        <Row label={t("Téléphone", "الهاتف")} value={store?.phone ?? "—"} />
        <Row label={t("TVA", "الضريبة")} value={store?.tvaRate ? `${store.tvaRate}%` : "—"} />
      </Card>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  label: { color: colors.textMuted, fontSize: 13 },
  value: { color: colors.text, fontSize: 13, fontWeight: "600" },
});
