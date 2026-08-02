import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
} from "react-native";
import { colors } from "@/lib/colors";

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = "primary", disabled, loading, testID, icon, style }: ButtonProps) {
  const bg =
    variant === "primary" ? colors.primary
    : variant === "danger" ? colors.danger
    : variant === "secondary" ? colors.surface
    : "transparent";
  const textColor = variant === "secondary" || variant === "ghost" ? colors.primary : "#fff";
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "secondary" && styles.buttonOutline,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Row style={{ gap: 6, justifyContent: "center" }}>
          {icon}
          <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>
        </Row>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Form field
// ---------------------------------------------------------------------------

export function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  editable = true,
  error,
  autoCapitalize = "sentences",
  autoCorrect = true,
  autoComplete,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "numeric" | "email-address" | "phone-pad" | "decimal-pad";
  multiline?: boolean;
  editable?: boolean;
  error?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  autoComplete?: "email" | "password" | "username" | "off";
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        autoComplete={autoComplete}
        style={[
          styles.input,
          multiline && { height: 90, textAlignVertical: "top" },
          !editable && { backgroundColor: colors.background, color: colors.textMuted },
          error && { borderColor: colors.danger },
        ]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  default: { bg: "#EEF2F7", fg: colors.primary },
  success: { bg: "#DCFCE7", fg: "#15803D" },
  warning: { bg: "#FEF3C7", fg: "#B45309" },
  danger: { bg: "#FEE2E2", fg: "#B91C1C" },
  info: { bg: "#DBEAFE", fg: "#1D4ED8" },
  muted: { bg: "#F1F5F9", fg: colors.textMuted },
};

export function Badge({ label, tone = "default" }: { label: string; tone?: keyof typeof BADGE_COLORS }) {
  const c = BADGE_COLORS[tone] ?? BADGE_COLORS.default;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Loading / empty states
// ---------------------------------------------------------------------------

export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text style={styles.mutedText}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.mutedText}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.centered}>
      <Text style={[styles.emptyTitle, { color: colors.danger }]}>{title}</Text>
      {subtitle ? <Text style={styles.mutedText}>{subtitle}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

export function SectionTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.sectionTitle, style]}>{children}</Text>;
}

export function ScreenTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.screenTitle}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: "row", alignItems: "center" },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8 },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonOutline: { borderWidth: 1, borderColor: colors.primary },
  buttonText: { fontWeight: "600", fontSize: 15 },
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: "500" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "600" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 6 },
  mutedText: { color: colors.textMuted, fontSize: 13, textAlign: "center" },
  emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  screenTitle: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: 4 },
});
