import React from "react";
import { Text, StyleSheet } from "react-native";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle } from "@/components/ui";
import { colors } from "@/lib/colors";

/**
 * The web ERP's real-time page is a live activity feed fed by the same WS
 * connection mounted at the app root (see RealtimeGate / use-realtime-ws).
 * Toasts already surface events app-wide; this screen explains that.
 */
export default function RealTime() {
  const { ready } = useProtectedRoute({ section: "realtime" });
  const { t } = useLang();

  if (!ready) return null;

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Connexion en temps réel", "الاتصال في الوقت الفعلي")}</SectionTitle>
        <Text style={styles.text}>
          {t(
            "Les transferts de stock, virements de caisse, commandes et alertes de stock sont notifiés automatiquement pendant que l'application est ouverte.",
            "يتم إشعارك تلقائيًا بتحويلات المخزون وحوالات الصندوق والطلبات وتنبيهات المخزون أثناء استخدام التطبيق.",
          )}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 13, color: colors.textMuted, lineHeight: 20 },
});
