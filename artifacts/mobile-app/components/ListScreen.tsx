import React from "react";
import { FlatList, View, StyleSheet, TextInput } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "@/lib/colors";
import { EmptyState, LoadingView } from "@/components/ui";

export function SearchBar({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.searchBar}>
      <Feather name="search" size={16} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
      />
    </View>
  );
}

export function ListScreen<T>({
  data,
  keyExtractor,
  renderItem,
  isLoading,
  emptyTitle,
  emptySubtitle,
  header,
  onRefresh,
  refreshing,
  onEndReached,
}: {
  data: T[] | undefined;
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => React.ReactElement;
  isLoading?: boolean;
  emptyTitle: string;
  emptySubtitle?: string;
  header?: React.ReactElement;
  onRefresh?: () => void;
  refreshing?: boolean;
  onEndReached?: () => void;
}) {
  if (isLoading && !data) return <LoadingView />;
  return (
    <FlatList
      data={data ?? []}
      keyExtractor={keyExtractor}
      renderItem={({ item }) => renderItem(item)}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyState title={emptyTitle} subtitle={emptySubtitle} />}
      contentContainerStyle={styles.listContent}
      onRefresh={onRefresh}
      refreshing={!!refreshing}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      style={{ backgroundColor: colors.background }}
    />
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    marginHorizontal: 16,
    marginTop: 16,
  },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 14, color: colors.text },
  listContent: { paddingBottom: 40 },
});
