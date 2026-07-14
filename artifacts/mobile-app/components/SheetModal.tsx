import React, { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors } from "@/lib/colors";
import { useLang } from "@/contexts/lang-context";

/**
 * Shared bottom-sheet style modal for hosting write-action forms
 * (create/edit screens, action pickers, etc). Slides up from the bottom,
 * dismisses on backdrop tap or the close button, and keyboard-avoids on iOS.
 */
export function SheetModal({
  visible,
  onClose,
  title,
  children,
  scrollable = true,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  scrollable?: boolean;
  footer?: React.ReactNode;
}) {
  const { isRTL } = useLang();
  const windowHeight = Dimensions.get("window").height;
  const translateY = useRef(new Animated.Value(windowHeight)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : windowHeight,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [visible, translateY, windowHeight]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} testID="button-close-sheet-backdrop" />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={[styles.header, isRTL && styles.headerRTL]}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {title}
              </Text>
              <Pressable onPress={onClose} hitSlop={12} testID="button-close-sheet">
                <Feather name="x" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
            {scrollable ? (
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
                {children}
              </ScrollView>
            ) : (
              <View style={styles.body}>{children}</View>
            )}
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "88%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRTL: { flexDirection: "row-reverse" },
  headerTitle: { fontSize: 16, fontWeight: "700", color: colors.text, flex: 1 },
  body: { padding: 18, paddingBottom: 24 },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
