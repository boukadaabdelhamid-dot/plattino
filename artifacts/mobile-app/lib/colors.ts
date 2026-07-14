export const colors = {
  primary: "#1B3057",
  primaryLight: "#2C4A7C",
  accent: "#C9A24B",
  background: "#F5F6F8",
  surface: "#FFFFFF",
  border: "#E3E6EB",
  text: "#171A21",
  textMuted: "#6B7280",
  danger: "#DC2626",
  success: "#16A34A",
  warning: "#D97706",
  info: "#2563EB",
} as const;

export function useColors() {
  return colors;
}
