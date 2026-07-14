import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  useGetErpSettingsProductsBrands,
  useGetErpSettingsProductsColors,
  useGetErpSettingsProductsFamilies,
  useGetErpSettingsProductsTypes,
  getGetErpSettingsProductsBrandsQueryKey,
  getGetErpSettingsProductsColorsQueryKey,
  getGetErpSettingsProductsFamiliesQueryKey,
  getGetErpSettingsProductsTypesQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle, Badge } from "@/components/ui";

function Chips({ items }: { items: string[] }) {
  return (
    <View style={styles.chips}>
      {items.length === 0 ? <Text style={styles.muted}>—</Text> : items.map((i) => <Badge key={i} label={i} />)}
    </View>
  );
}

export default function ProductSettings() {
  const { ready } = useProtectedRoute({ section: "settings" });
  const { t, lang } = useLang();
  const localized = (item: { nameAr: string; nameFr: string }) => (lang === "ar" ? item.nameAr : item.nameFr);

  const { data: brands } = useGetErpSettingsProductsBrands({
    query: { enabled: ready, queryKey: getGetErpSettingsProductsBrandsQueryKey() },
  });
  const { data: families } = useGetErpSettingsProductsFamilies({
    query: { enabled: ready, queryKey: getGetErpSettingsProductsFamiliesQueryKey() },
  });
  const { data: colorsList } = useGetErpSettingsProductsColors({
    query: { enabled: ready, queryKey: getGetErpSettingsProductsColorsQueryKey() },
  });
  const { data: types } = useGetErpSettingsProductsTypes({
    query: { enabled: ready, queryKey: getGetErpSettingsProductsTypesQueryKey() },
  });

  if (!ready) return null;

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Marques", "الماركات")}</SectionTitle>
        <Chips items={brands?.items.map(localized) ?? []} />
      </Card>
      <Card>
        <SectionTitle>{t("Familles", "الفئات")}</SectionTitle>
        <Chips items={families?.items.map(localized) ?? []} />
      </Card>
      <Card>
        <SectionTitle>{t("Couleurs", "الألوان")}</SectionTitle>
        <Chips items={colorsList?.items.map(localized) ?? []} />
      </Card>
      <Card>
        <SectionTitle>{t("Types de catalogue", "أنواع الكتالوج")}</SectionTitle>
        <Chips items={types?.items.map(localized) ?? []} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  muted: { fontSize: 13, color: "#94A3B8" },
});
