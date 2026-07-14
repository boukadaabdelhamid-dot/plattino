import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  useGetErpAccountMe,
  useGetErpCaisseTransfers,
  getGetErpAccountMeQueryKey,
  getGetErpCaisseTransfersQueryKey,
  GetErpCaisseTransfersBox,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useMe } from "@/hooks/use-me";
import { Screen } from "@/components/Screen";
import { Card, LoadingView, SectionTitle, Badge, Divider } from "@/components/ui";
import { colors } from "@/lib/colors";

function statusTone(status: string): "success" | "warning" | "danger" | "muted" {
  if (status === "accepted" || status === "received") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected" || status === "cancelled") return "danger";
  return "muted";
}

export default function MonCompte() {
  const { ready } = useProtectedRoute();
  const { t, lang } = useLang();
  const { isAdmin, role } = useMe();
  const currency = lang === "ar" ? "دج" : "DA";

  const { data: account, isLoading } = useGetErpAccountMe({
    query: { enabled: ready, queryKey: getGetErpAccountMeQueryKey() },
  });
  const transferParams = { box: GetErpCaisseTransfersBox.all };
  const { data: transfers } = useGetErpCaisseTransfers(transferParams, {
    query: { enabled: ready, queryKey: getGetErpCaisseTransfersQueryKey(transferParams) },
  });

  if (!ready) return <LoadingView />;

  const myId = (account as { user?: { id?: number } })?.user?.id ?? null;
  const mine = (transfers ?? []).filter(
    (tr: any) => tr.senderCaisse?.ownerUserId === myId || tr.recipientCaisse?.ownerUserId === myId,
  );
  const roleLabel = role === "admin" ? t("Administrateur", "مدير") : role === "employee" ? t("Employé", "موظف") : (role ?? "—");
  const storeName = (account as any)?.store
    ? (lang === "ar" ? (account as any).store.nameAr : (account as any).store.nameEn)
    : "—";

  return (
    <Screen>
      {isLoading ? (
        <LoadingView />
      ) : (
        <>
          <Card>
            <SectionTitle>{t("Profil", "الملف الشخصي")}</SectionTitle>
            <Row label={t("Nom", "الاسم")} value={(account as any)?.user?.name ?? "—"} />
            <Row label={t("Email", "البريد الإلكتروني")} value={(account as any)?.user?.email ?? "—"} />
            <Row label={t("Rôle", "الدور")} value={roleLabel} />
            <Row label={t("Magasin", "المتجر")} value={storeName} />
          </Card>

          <Card>
            <SectionTitle>{t("Solde de caisse", "رصيد الصندوق")}</SectionTitle>
            <Text style={styles.balance}>
              {Number((account as any)?.caisse?.balance ?? 0).toLocaleString("fr-FR")} {currency}
            </Text>
          </Card>

          <Card>
            <SectionTitle>{t("Virements récents", "الحوالات الأخيرة")}</SectionTitle>
            {mine.length === 0 ? (
              <Text style={styles.muted}>{t("Aucun virement", "لا توجد حوالات")}</Text>
            ) : (
              mine.slice(0, 15).map((tr: any, i: number) => (
                <View key={tr.id}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.transferRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.transferId}>#{tr.id}</Text>
                      <Text style={styles.muted}>
                        {Number(tr.amount ?? 0).toLocaleString("fr-FR")} {currency}
                      </Text>
                    </View>
                    <Badge label={tr.status} tone={statusTone(tr.status)} />
                  </View>
                </View>
              ))
            )}
          </Card>
        </>
      )}
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
  balance: { fontSize: 24, fontWeight: "700", color: colors.primary },
  muted: { color: colors.textMuted, fontSize: 13 },
  transferRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 8 },
  transferId: { fontSize: 13, fontWeight: "600", color: colors.text },
});
