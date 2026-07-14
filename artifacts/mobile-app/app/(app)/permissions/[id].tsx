import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Switch } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useGetErpStaff, getGetErpStaffQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import {
  useStaffPermissions,
  useSaveStaffPermissions,
  buildPermMap,
  mapToPermRows,
  PERMISSION_SECTIONS,
  PERMISSION_ACTIONS,
} from "@/hooks/use-admin-api";
import { Screen } from "@/components/Screen";
import { Card, Button, SectionTitle, LoadingView, ErrorState, ScreenTitle, Badge } from "@/components/ui";
import { colors } from "@/lib/colors";

/** Per-section/action permission grid for one staff member, mirroring the web ERP's Permissions page. */
export default function EditStaffPermissions() {
  const { ready } = useProtectedRoute({ adminOnly: true });
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const { t } = useLang();
  const router = useRouter();
  const feedback = useApiFeedback();

  const { data: staff } = useGetErpStaff({
    query: { enabled: ready, queryKey: getGetErpStaffQueryKey() },
  });
  const member = (staff as any[] | undefined)?.find((s) => s.id === userId);

  const { data: rows, isLoading, isError, refetch } = useStaffPermissions(ready ? userId : null);
  const savePerms = useSaveStaffPermissions();

  const [map, setMap] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (rows) setMap(buildPermMap(rows));
  }, [rows]);

  const granted = useMemo(() => Array.from(map.values()).filter(Boolean).length, [map]);
  const total = PERMISSION_SECTIONS.length * PERMISSION_ACTIONS.length;

  if (!ready) return null;
  if (Number.isNaN(userId)) return <ErrorState title={t("Membre introuvable", "العضو غير موجود")} />;
  if (isLoading) return <LoadingView />;
  if (isError) return <ErrorState title={t("Erreur de chargement", "خطأ في التحميل")} />;

  function toggle(section: string, action: string, value: boolean) {
    setMap((prev) => {
      const next = new Map(prev);
      next.set(`${section}:${action}`, value);
      return next;
    });
  }

  function toggleSection(section: string, value: boolean) {
    setMap((prev) => {
      const next = new Map(prev);
      PERMISSION_ACTIONS.forEach((a) => next.set(`${section}:${a.key}`, value));
      return next;
    });
  }

  function setAll(value: boolean) {
    setMap((prev) => {
      const next = new Map(prev);
      PERMISSION_SECTIONS.forEach((s) => PERMISSION_ACTIONS.forEach((a) => next.set(`${s.key}:${a.key}`, value)));
      return next;
    });
  }

  function handleSave() {
    savePerms.mutate(
      { userId, perms: mapToPermRows(map) },
      {
        onSuccess: () => {
          feedback.success("Permissions enregistrées", "تم حفظ الصلاحيات");
          refetch();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <View style={{ marginBottom: 4 }}>
        <ScreenTitle>{member?.name ?? t("Permissions", "الصلاحيات")}</ScreenTitle>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          {member?.role ? (
            <Badge label={member.role === "admin" ? t("Administrateur", "مدير") : t("Employé", "موظف")} tone={member.role === "admin" ? "info" : "muted"} />
          ) : null}
          <Text style={styles.count}>{t(`${granted}/${total} accordées`, `${granted}/${total} ممنوحة`)}</Text>
        </View>
        {member?.role === "admin" ? (
          <Text style={styles.hint}>
            {t(
              "Les administrateurs ont accès à tout, quels que soient ces réglages.",
              "المدراء لديهم صلاحية كاملة بغض النظر عن هذه الإعدادات.",
            )}
          </Text>
        ) : null}
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
        <Button label={t("Tout accorder", "منح الكل")} variant="secondary" onPress={() => setAll(true)} style={{ flex: 1 }} testID="button-grant-all" />
        <Button label={t("Tout révoquer", "إلغاء الكل")} variant="secondary" onPress={() => setAll(false)} style={{ flex: 1 }} testID="button-revoke-all" />
      </View>

      {PERMISSION_SECTIONS.map((section) => {
        const allGranted = PERMISSION_ACTIONS.every((a) => map.get(`${section.key}:${a.key}`));
        return (
          <Card key={section.key} style={{ marginBottom: 10 }}>
            <View style={styles.sectionHeader}>
              <SectionTitle style={{ marginBottom: 0 }}>{t(section.fr, section.ar)}</SectionTitle>
              <Switch
                value={allGranted}
                onValueChange={(v) => toggleSection(section.key, v)}
                trackColor={{ true: colors.primary }}
                testID={`switch-section-${section.key}`}
              />
            </View>
            {PERMISSION_ACTIONS.map((action) => (
              <View key={action.key} style={styles.actionRow}>
                <Text style={styles.actionLabel}>{t(action.fr, action.ar)}</Text>
                <Switch
                  value={!!map.get(`${section.key}:${action.key}`)}
                  onValueChange={(v) => toggle(section.key, action.key, v)}
                  trackColor={{ true: colors.primary }}
                  testID={`switch-${section.key}-${action.key}`}
                />
              </View>
            ))}
          </Card>
        );
      })}

      <Button
        label={t("Enregistrer", "حفظ")}
        onPress={handleSave}
        loading={savePerms.isPending}
        testID="button-save-permissions"
      />
      <Button label={t("Annuler", "إلغاء")} variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  count: { fontSize: 12.5, color: colors.textMuted },
  hint: { fontSize: 12, color: colors.warning, marginTop: 6 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  actionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionLabel: { fontSize: 14, color: colors.text },
});
