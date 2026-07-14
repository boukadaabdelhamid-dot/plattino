import React from "react";
import { View, Text, StyleSheet, Image, Pressable } from "react-native";
import { DrawerContentScrollView } from "@react-navigation/drawer";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import { useRouter, usePathname } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/lib/colors";
import { useLang } from "@/contexts/lang-context";
import { useLanguageSwitch } from "@/hooks/use-language-switch";
import { useMe } from "@/hooks/use-me";
import { usePermissions } from "@/contexts/permissions-context";
import { useAuth } from "@/contexts/auth-context";
import { MENU_GROUPS } from "@/lib/menu";

export default function DrawerContent(props: DrawerContentComponentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { lang, t } = useLang();
  const { toggleLanguage } = useLanguageSwitch();
  const { user, isAdmin } = useMe();
  const { can } = usePermissions();
  const { logout } = useAuth();

  const visibleGroups = MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (isAdmin) return true;
      if (item.adminOnly) return false;
      if (item.section) return can(item.section, "view");
      return true;
    }),
  })).filter((group) => group.items.length > 0);

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: 0 }}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.brand}>Midanic</Text>
        <Text style={styles.brandSub}>{t("Espace personnel", "المساحة الإدارية")}</Text>
        {user ? (
          <Text style={styles.userLine} numberOfLines={1}>
            {(user as { name?: string; email?: string }).name ?? (user as { email?: string }).email}
          </Text>
        ) : null}
      </View>

      {visibleGroups.map((group) => (
        <View key={group.key} style={styles.group}>
          <Text style={styles.groupTitle}>{t(group.titleFr, group.titleAr)}</Text>
          {group.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Pressable
                key={item.key}
                onPress={() => router.push(item.href as never)}
                style={[styles.item, active && styles.itemActive]}
              >
                <Feather name={item.icon} size={18} color={active ? colors.primary : colors.textMuted} />
                <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>
                  {t(item.labelFr, item.labelAr)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      <View style={styles.footer}>
        <Pressable style={styles.langSwitch} onPress={toggleLanguage}>
          <Feather name="globe" size={16} color={colors.textMuted} />
          <Text style={styles.itemLabel}>{lang === "ar" ? "Français" : "العربية"}</Text>
        </Pressable>
        <Pressable style={styles.logout} onPress={() => logout()}>
          <Feather name="log-out" size={16} color={colors.danger} />
          <Text style={[styles.itemLabel, { color: colors.danger }]}>{t("Déconnexion", "تسجيل الخروج")}</Text>
        </Pressable>
      </View>
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.primary, paddingBottom: 20, paddingHorizontal: 20, marginBottom: 8 },
  brand: { color: "#fff", fontSize: 22, fontWeight: "700" },
  brandSub: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 2 },
  userLine: { color: "rgba(255,255,255,0.9)", fontSize: 12, marginTop: 10 },
  group: { paddingHorizontal: 12, marginBottom: 10 },
  groupTitle: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, marginLeft: 8 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 },
  itemActive: { backgroundColor: "#EEF2F7" },
  itemLabel: { fontSize: 14, color: colors.text },
  itemLabelActive: { color: colors.primary, fontWeight: "600" },
  footer: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8, paddingTop: 8, paddingHorizontal: 12, gap: 4 },
  langSwitch: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8 },
  logout: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 8 },
});
