import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useLanguageSwitch } from "@/hooks/use-language-switch";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function SettingsLanguages() {
  const { ready } = useProtectedRoute({ section: "settings" });
  const { t, lang } = useLang();
  const { selectLanguage } = useLanguageSwitch();

  if (!ready) return null;

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Langue de l'interface", "لغة الواجهة")}</SectionTitle>
        {(["fr", "ar"] as const).map((l) => (
          <Pressable key={l} style={styles.row} onPress={() => selectLanguage(l)} testID={`option-language-${l}`}>
            <Text style={styles.label}>{l === "fr" ? "Français" : "العربية"}</Text>
            {lang === l ? <Feather name="check" size={18} color={colors.primary} /> : null}
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12 },
  label: { fontSize: 15, color: colors.text },
});
