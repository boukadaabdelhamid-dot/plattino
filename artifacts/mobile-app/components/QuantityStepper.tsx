import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "@/lib/colors";
import { useLang } from "@/contexts/lang-context";

/** Small +/- quantity control used inside cart lines (order/retour item rows). */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
}) {
  const { isRTL } = useLang();
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(max != null ? Math.min(max, value + 1) : value + 1);
  return (
    <View style={[styles.wrap, isRTL && styles.wrapRTL]}>
      <Pressable onPress={dec} disabled={value <= min} style={styles.btn} testID="button-qty-decrease" hitSlop={8}>
        <Feather name="minus" size={14} color={value <= min ? colors.textMuted : colors.primary} />
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable
        onPress={inc}
        disabled={max != null && value >= max}
        style={styles.btn}
        testID="button-qty-increase"
        hitSlop={8}
      >
        <Feather name="plus" size={14} color={max != null && value >= max ? colors.textMuted : colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 10 },
  wrapRTL: { flexDirection: "row-reverse" },
  btn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  value: { fontSize: 15, fontWeight: "700", color: colors.text, minWidth: 22, textAlign: "center" },
});
