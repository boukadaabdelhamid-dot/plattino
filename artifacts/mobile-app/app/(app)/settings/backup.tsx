import React from "react";
import { Text, StyleSheet } from "react-native";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function SettingsBackup() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { t } = useLang();

  if (!ready) return null;

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Sauvegarde", "النسخ الاحتياطي")}</SectionTitle>
        <Text style={styles.text}>
          {t(
            "La sauvegarde et la restauration des données se gèrent depuis l'espace web de l'ERP.",
            "يتم إدارة النسخ الاحتياطي واستعادة البيانات من واجهة الويب.",
          )}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({ text: { fontSize: 13, color: colors.textMuted, lineHeight: 20 } });
