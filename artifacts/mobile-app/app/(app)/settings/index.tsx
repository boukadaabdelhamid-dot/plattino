import React from "react";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useMe } from "@/hooks/use-me";
import { Screen } from "@/components/Screen";
import { EntityRow } from "@/components/EntityRow";

export default function Settings() {
  const { ready } = useProtectedRoute({ section: "settings" });
  const { t } = useLang();
  const { isAdmin } = useMe();
  const router = useRouter();

  if (!ready) return null;

  const items: { href: string; icon: keyof typeof Feather.glyphMap; labelFr: string; labelAr: string; adminOnly?: boolean }[] = [
    { href: "/settings/profile", icon: "user", labelFr: "Profil", labelAr: "الملف الشخصي" },
    { href: "/settings/products", icon: "package", labelFr: "Produits (marques, familles...)", labelAr: "المنتجات (الماركات، الفئات...)" },
    { href: "/settings/customers", icon: "users", labelFr: "Clients (classements, tarifs)", labelAr: "العملاء (التصنيفات، الأسعار)" },
    { href: "/settings/notifications", icon: "bell", labelFr: "Notifications", labelAr: "الإشعارات" },
    { href: "/settings/languages", icon: "globe", labelFr: "Langues", labelAr: "اللغات" },
    { href: "/settings/staff", icon: "user-check", labelFr: "Personnel", labelAr: "الموظفون" },
    { href: "/settings/backup", icon: "database", labelFr: "Sauvegarde", labelAr: "النسخ الاحتياطي", adminOnly: true },
    { href: "/settings/web-store", icon: "shopping-bag", labelFr: "Boutique en ligne", labelAr: "المتجر الإلكتروني", adminOnly: true },
  ];

  const visible = items.filter((i) => !i.adminOnly || isAdmin);

  return (
    <Screen scroll={false}>
      {visible.map((i) => (
        <EntityRow
          key={i.href}
          title={t(i.labelFr, i.labelAr)}
          onPress={() => router.push(i.href as never)}
        />
      ))}
    </Screen>
  );
}
