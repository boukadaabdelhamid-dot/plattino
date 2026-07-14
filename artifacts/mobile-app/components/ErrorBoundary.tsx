import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { reloadAppAsync } from "expo";
import { colors } from "@/lib/colors";
import { Button } from "@/components/ui";

function ErrorFallback({ onReload }: { onReload: () => void }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>خطأ غير متوقع / Une erreur est survenue</Text>
      <Text style={styles.subtitle}>Veuillez redémarrer l'application.</Text>
      <Button label="Redémarrer / إعادة التشغيل" onPress={onReload} style={{ marginTop: 16, minWidth: 200 }} />
    </View>
  );
}

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (__DEV__) console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReload={() => reloadAppAsync()} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: colors.background },
  title: { fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 8, textAlign: "center" },
});
