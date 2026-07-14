import React from "react";
import { Modal, View, Text, StyleSheet, Pressable } from "react-native";
import { colors } from "@/lib/colors";
import { useLang } from "@/contexts/lang-context";
import { Button } from "@/components/ui";

/**
 * Presentational confirm dialog for approve/reject/cancel/delete-style
 * actions. Most screens should use `useConfirm()` (see
 * `contexts/confirm-context.tsx`) instead of rendering this directly, but it
 * is also usable standalone for a locally-controlled confirm flow.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  loading,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { isRTL } = useLang();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.card}>
          <Text style={[styles.title, isRTL && styles.textRTL]}>{title}</Text>
          {message ? <Text style={[styles.message, isRTL && styles.textRTL]}>{message}</Text> : null}
          <View style={[styles.actions, isRTL && styles.actionsRTL]}>
            <Button label={cancelLabel} onPress={onCancel} variant="secondary" style={styles.actionButton} disabled={loading} />
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? "danger" : "primary"}
              loading={loading}
              style={styles.actionButton}
              testID="button-confirm-dialog-confirm"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  message: { fontSize: 14, color: colors.textMuted, marginTop: 8, lineHeight: 20 },
  textRTL: { textAlign: "right" },
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  actionsRTL: { flexDirection: "row-reverse" },
  actionButton: { flex: 1 },
});
