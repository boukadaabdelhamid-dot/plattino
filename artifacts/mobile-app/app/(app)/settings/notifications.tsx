import React, { useState } from "react";
import { View, Text, StyleSheet, Switch } from "react-native";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle } from "@/components/ui";
import { colors } from "@/lib/colors";

const TOPICS = [
  { key: "transfers", labelFr: "Transferts de stock", labelAr: "تحويلات المخزون" },
  { key: "orders", labelFr: "Nouvelles commandes", labelAr: "طلبات جديدة" },
  { key: "caisse", labelFr: "Virements de caisse", labelAr: "حوالات الصندوق" },
  { key: "stock", labelFr: "Alertes de stock faible", labelAr: "تنبيهات نقص المخزون" },
];

/** In-app toast notifications (via the realtime WS) — always on while the app is open. */
export default function SettingsNotifications() {
  const { ready } = useProtectedRoute({ section: "settings" });
  const { t } = useLang();
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ transfers: true, orders: true, caisse: true, stock: true });

  if (!ready) return null;

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Notifications en temps réel", "الإشعارات في الوقت الفعلي")}</SectionTitle>
        {TOPICS.map((topic) => (
          <View key={topic.key} style={styles.row}>
            <Text style={styles.label}>{t(topic.labelFr, topic.labelAr)}</Text>
            <Switch
              value={enabled[topic.key]}
              onValueChange={(v) => setEnabled((prev) => ({ ...prev, [topic.key]: v }))}
              trackColor={{ true: colors.primary }}
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10 },
  label: { fontSize: 14, color: colors.text, flex: 1, marginRight: 8 },
});
