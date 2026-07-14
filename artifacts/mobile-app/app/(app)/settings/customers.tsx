import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  useGetErpCustomerClassifications,
  useGetErpPriceTiers,
  getGetErpCustomerClassificationsQueryKey,
  getGetErpPriceTiersQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle, Divider } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function SettingsCustomers() {
  const { ready } = useProtectedRoute({ section: "settings" });
  const { t, lang } = useLang();

  const { data: classifications } = useGetErpCustomerClassifications({
    query: { enabled: ready, queryKey: getGetErpCustomerClassificationsQueryKey() },
  });
  const { data: priceTiers } = useGetErpPriceTiers({
    query: { enabled: ready, queryKey: getGetErpPriceTiersQueryKey() },
  });

  if (!ready) return null;

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Classements clients", "تصنيفات العملاء")}</SectionTitle>
        {(classifications ?? []).length === 0 ? (
          <Text style={styles.muted}>—</Text>
        ) : (
          (classifications ?? []).map((c, i) => (
            <View key={c.id}>
              {i > 0 ? <Divider /> : null}
              <Text style={styles.item}>{lang === "ar" ? c.labelAr : c.labelFr}</Text>
            </View>
          ))
        )}
      </Card>
      <Card>
        <SectionTitle>{t("Paliers tarifaires", "مستويات التسعير")}</SectionTitle>
        {(priceTiers ?? []).length === 0 ? (
          <Text style={styles.muted}>—</Text>
        ) : (
          (priceTiers ?? []).map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <Divider /> : null}
              <Text style={styles.item}>{lang === "ar" ? p.labelAr : p.labelFr} ({p.code})</Text>
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13, color: colors.textMuted },
  item: { fontSize: 14, color: colors.text, paddingVertical: 4 },
});
