import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "@/lib/colors";
import { useLang } from "@/contexts/lang-context";

/** Multi-select checklist of stores, used to assign a staff member's store access. */
export function StoreCheckList({
  label,
  stores,
  selectedIds,
  onChange,
  error,
}: {
  label: string;
  stores: { id: number; nameFr?: string; nameEn?: string; nameAr?: string }[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  error?: string;
}) {
  const { isRTL, lang, t } = useLang();

  function toggle(id: number) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((i) => i !== id));
    else onChange([...selectedIds, id]);
  }

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.list}>
        {stores.map((store, i) => {
          const selected = selectedIds.includes(store.id);
          const name = lang === "ar" ? (store.nameAr ?? store.nameEn) : (store.nameEn ?? store.nameAr);
          return (
            <Pressable
              key={store.id}
              onPress={() => toggle(store.id)}
              style={[styles.row, isRTL && styles.rowRTL, i > 0 && styles.rowBorder]}
              testID={`option-store-${store.id}`}
            >
              <Text style={styles.rowLabel}>{name}</Text>
              <Feather
                name={selected ? "check-square" : "square"}
                size={20}
                color={selected ? colors.primary : colors.textMuted}
              />
            </Pressable>
          );
        })}
        {stores.length === 0 ? (
          <Text style={styles.mutedText}>{t("Aucun magasin", "لا توجد متاجر")}</Text>
        ) : null}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: "500" },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowRTL: { flexDirection: "row-reverse" },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { fontSize: 14.5, color: colors.text },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: 4 },
  mutedText: { color: colors.textMuted, fontSize: 13, padding: 14 },
});
