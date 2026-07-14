import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, FlatList } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "@/lib/colors";
import { useLang } from "@/contexts/lang-context";
import { SheetModal } from "@/components/SheetModal";
import { SearchBar } from "@/components/ListScreen";
import { EmptyState } from "@/components/ui";

/**
 * Generic searchable picker for choosing one item from a list (product,
 * supplier, employee, customer, store, ...) inside a form. Renders as a
 * form-field-like trigger; tapping it opens a sheet with a search box and
 * a filtered list.
 */
export function PickerField<T>({
  label,
  value,
  items,
  keyExtractor,
  labelExtractor,
  subtitleExtractor,
  onChange,
  placeholder,
  searchPlaceholder,
  error,
  disabled,
  emptyLabel,
}: {
  label: string;
  value: T | null;
  items: T[];
  keyExtractor: (item: T) => string;
  labelExtractor: (item: T) => string;
  subtitleExtractor?: (item: T) => string | undefined;
  onChange: (item: T) => void;
  placeholder: string;
  searchPlaceholder?: string;
  error?: string;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const { isRTL, t } = useLang();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const label = labelExtractor(item).toLowerCase();
      const subtitle = subtitleExtractor?.(item)?.toLowerCase() ?? "";
      return label.includes(q) || subtitle.includes(q);
    });
  }, [items, query, labelExtractor, subtitleExtractor]);

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        style={[
          styles.trigger,
          isRTL && styles.triggerRTL,
          error && { borderColor: colors.danger },
          disabled && { backgroundColor: colors.background },
        ]}
        testID="button-open-picker"
      >
        <Text style={[styles.triggerText, !value && { color: colors.textMuted }]} numberOfLines={1}>
          {value ? labelExtractor(value) : placeholder}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}

      <SheetModal visible={open} onClose={() => setOpen(false)} title={label} scrollable={false}>
        <View style={{ marginHorizontal: -18, marginTop: -18 }}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder ?? t("Rechercher...", "بحث...")}
          />
          <FlatList
            data={filtered}
            keyExtractor={keyExtractor}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 420 }}
            ListEmptyComponent={
              <EmptyState title={emptyLabel ?? t("Aucun résultat", "لا توجد نتائج")} />
            }
            renderItem={({ item }) => {
              const selected = value != null && keyExtractor(item) === keyExtractor(value);
              const subtitle = subtitleExtractor?.(item);
              return (
                <Pressable
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                    setQuery("");
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    isRTL && styles.rowRTL,
                    pressed && { backgroundColor: colors.background },
                  ]}
                  testID={`option-picker-${keyExtractor(item)}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{labelExtractor(item)}</Text>
                    {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
                  </View>
                  {selected ? <Feather name="check" size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: "500" },
  trigger: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  triggerRTL: { flexDirection: "row-reverse" },
  triggerText: { flex: 1, fontSize: 15, color: colors.text },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowRTL: { flexDirection: "row-reverse" },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
  rowSubtitle: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
});
