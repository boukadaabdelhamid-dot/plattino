import React, { useState } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { useRouter } from "expo-router";
import { useGetProducts, getGetProductsQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { ListScreen, SearchBar } from "@/components/ListScreen";
import { Badge } from "@/components/ui";
import { Fab } from "@/components/Fab";
import { colors } from "@/lib/colors";
import { Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";

export default function ProductsList() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "products" });
  const { t, lang } = useLang();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const currency = lang === "ar" ? "دج" : "DA";

  const productsParams = { search: search || undefined, limit: 50 };
  const { data, isLoading, refetch, isRefetching } = useGetProducts(productsParams, {
    query: { enabled: ready, queryKey: getGetProductsQueryKey(productsParams) },
  });
  const products = ((data as any)?.products ?? []) as any[];

  if (!ready) return null;
  const canCreate = isAdmin || can("products", "create");

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        data={products}
        isLoading={isLoading}
        onRefresh={refetch}
        refreshing={isRefetching}
        keyExtractor={(p) => String(p.id)}
        emptyTitle={t("Aucun produit", "لا توجد منتجات")}
        header={<SearchBar value={search} onChangeText={setSearch} placeholder={t("Rechercher un produit...", "بحث عن منتج...")} />}
        renderItem={(p) => (
          <Pressable style={styles.row} onPress={() => router.push(`/products/${p.id}` as never)} testID={`row-product-${p.id}`}>
            {p.imageUrl ? (
              <Image source={{ uri: p.imageUrl }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Feather name="package" size={20} color={colors.textMuted} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{lang === "ar" ? p.nameAr : p.nameEn}</Text>
              <Text style={styles.ref}>{p.reference ?? p.barcode ?? ""}</Text>
              <Text style={styles.price}>{Number(p.price).toLocaleString("fr-FR")} {currency}</Text>
            </View>
            <Badge label={String(p.stock)} tone={p.stock <= 0 ? "danger" : p.stock < 5 ? "warning" : "success"} />
          </Pressable>
        )}
      />
      {canCreate ? <Fab onPress={() => router.push("/products/new" as never)} testID="button-new-product" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  thumbPlaceholder: { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 14, fontWeight: "600", color: colors.text },
  ref: { fontSize: 11, color: colors.textMuted },
  price: { fontSize: 13, fontWeight: "600", color: colors.primary, marginTop: 2 },
});
