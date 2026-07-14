import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  useGetErpCustomer,
  useGetCustomerOperations,
  getGetErpCustomerQueryKey,
  getGetCustomerOperationsQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, LoadingView, SectionTitle, Divider, ErrorState } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready } = useProtectedRoute({ section: "customers" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const customerId = Number(id);

  const { data: customer, isLoading, isError } = useGetErpCustomer(customerId, {
    query: { enabled: ready && !!customerId, queryKey: getGetErpCustomerQueryKey(customerId) },
  });
  const { data: ops } = useGetCustomerOperations(customerId, undefined, {
    query: { enabled: ready && !!customerId, queryKey: getGetCustomerOperationsQueryKey(customerId) },
  });

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (isError || !customer) return <ErrorState title={t("Client introuvable", "العميل غير موجود")} />;

  const c = customer as any;

  return (
    <Screen>
      <Card>
        <SectionTitle>{c.name}</SectionTitle>
        <Text style={styles.label}>{t("Téléphone", "الهاتف")}</Text>
        <Text style={styles.value}>{c.phone ?? "—"}</Text>
        <Text style={styles.label}>{t("Email", "البريد الإلكتروني")}</Text>
        <Text style={styles.value}>{c.email ?? "—"}</Text>
        <Text style={styles.label}>{t("Adresse", "العنوان")}</Text>
        <Text style={styles.value}>{c.address ?? "—"}</Text>
      </Card>

      <Card>
        <SectionTitle>{t("Solde", "الرصيد")}</SectionTitle>
        <Text style={[styles.balance, { color: Number(c.currentBalance) < 0 ? colors.danger : colors.primary }]}>
          {Number(c.currentBalance ?? 0).toLocaleString("fr-FR")} {currency}
        </Text>
      </Card>

      <Card>
        <SectionTitle>{t("Opérations", "العمليات")}</SectionTitle>
        {!ops || (ops as any[]).length === 0 ? (
          <Text style={styles.muted}>{t("Aucune opération", "لا توجد عمليات")}</Text>
        ) : (
          (ops as any[]).slice(0, 20).map((op, i) => (
            <View key={op.id ?? i}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.opRow}>
                <Text style={{ flex: 1 }}>{op.type}</Text>
                <Text>{Number(op.amount ?? 0).toLocaleString("fr-FR")} {currency}</Text>
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
  balance: { fontSize: 22, fontWeight: "700" },
  opRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
});
