import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle, LoadingView } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function SettingsProfile() {
  const { ready } = useProtectedRoute({ section: "settings" });
  const { t } = useLang();
  const { data: me, isLoading } = useGetMe({ query: { enabled: ready, queryKey: getGetMeQueryKey() } });

  if (!ready) return null;
  if (isLoading) return <LoadingView />;

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Profil", "الملف الشخصي")}</SectionTitle>
        <Row label={t("Nom", "الاسم")} value={me?.name ?? "—"} />
        <Row label={t("Email", "البريد الإلكتروني")} value={me?.email ?? "—"} />
        <Row label={t("Rôle", "الدور")} value={me?.role ?? "—"} />
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
