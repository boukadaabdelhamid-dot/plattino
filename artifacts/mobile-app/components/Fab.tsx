import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "@/lib/colors";
import { useLang } from "@/contexts/lang-context";

/** Floating action button anchored bottom-trailing, RTL-aware, for list screens' primary create action. */
export function Fab({ onPress, testID, icon = "plus" }: { onPress: () => void; testID?: string; icon?: keyof typeof Feather.glyphMap }) {
  const { isRTL } = useLang();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={[styles.fab, isRTL ? { left: 20 } : { right: 20 }]}
      hitSlop={8}
    >
      <Feather name={icon} size={24} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
});
