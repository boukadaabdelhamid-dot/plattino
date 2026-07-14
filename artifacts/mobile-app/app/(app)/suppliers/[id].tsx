import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  useGetSupplierOperations,
  useGetSuppliers,
  getGetSuppliersQueryKey,
  getGetSupplierOperationsQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, Button, LoadingView, SectionTitle, Divider, ErrorState } from "@/components/ui";
import { colors } from "@/lib/colors";

export default function SupplierDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { ready, isAdmin, can } = useProtectedRoute({ section: "suppliers" });
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const supplierId = Number(id);

  // No single-supplier GET endpoint is generated; look it up from the list.
  const suppliersParams = { limit: 200 };
  const { data: list, isLoading } = useGetSuppliers(suppliersParams, {
    query: { enabled: ready, queryKey: getGetSuppliersQueryKey(suppliersParams) },
  });
  const supplier = ((list as any)?.data ?? []).find((s: any) => s.id === supplierId);
  const { data: ops } = useGetSupplierOperations(supplierId, {
    query: { enabled: ready && !!supplierId, queryKey: getGetSupplierOperationsQueryKey(supplierId) },
  });

  if (!ready) return null;
  if (isLoading) return <LoadingView />;
  if (!supplier) return <ErrorState title={t("Fournisseur introuvable", "المورد غير موجود")} />;

  const canEdit = isAdmin || can("suppliers", "edit");

  return (
    <Screen>
      <Card>
        <SectionTitle>{supplier.name}</SectionTitle>
        <Row label={t("Téléphone", "الهاتف")} value={supplier.phone ?? "—"} />
        <Row label={t("Email", "البريد الإلكتروني")} value={supplier.email ?? "—"} />
        <Row label={t("Adresse", "العنوان")} value={supplier.address ?? "—"} />
      </Card>

      {canEdit ? (
        <Button
          label={t("Modifier le fournisseur", "تعديل المورد")}
          variant="secondary"
          onPress={() => router.push(`/suppliers/${supplierId}/edit` as never)}
          testID="button-edit-supplier"
        />
      ) : null}

      <Card>
        <SectionTitle>{t("Solde dû", "الرصيد المستحق")}</SectionTitle>
        <Text style={[styles.balance, { color: Number(supplier.currentBalance) > 0 ? colors.danger : colors.primary }]}>
          {Number(supplier.currentBalance ?? 0).toLocaleString("fr-FR")} {currency}
        </Text>
      </Card>

      <Card>
        <SectionTitle>{t("Opérations", "العمليات")}</SectionTitle>
        {!ops || (ops as any).operations?.length === 0 ? (
          <Text style={styles.muted}>{t("Aucune opération", "لا توجد عمليات")}</Text>
        ) : (
          ((ops as any).operations as any[]).slice(0, 20).map((op, i) => (
            <View key={op.id ?? i}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.row}>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  rowLabel: { color: colors.textMuted, fontSize: 13 },
  rowValue: { color: colors.text, fontSize: 13, fontWeight: "600" },
  balance: { fontSize: 22, fontWeight: "700" },
  muted: { fontSize: 13, color: colors.textMuted },
});
