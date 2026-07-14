import React from "react";
import { View, StyleSheet, ScrollView, RefreshControl, type StyleProp, type ViewStyle } from "react-native";
import { colors } from "@/lib/colors";

/**
 * Generic screen container. Use `scroll` for content-driven screens and
 * `scroll={false}` for screens that manage their own FlatList/scrolling.
 */
export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing,
  style,
  contentContainerStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  if (!scroll) {
    return <View style={[styles.container, style]}>{children}</View>;
  }
  return (
    <ScrollView
      style={[styles.container, style]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined
      }
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
});
