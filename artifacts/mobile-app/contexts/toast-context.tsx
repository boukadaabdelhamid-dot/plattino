import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { StyleSheet, Text, View, Animated, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/lib/colors";

export type ToastOptions = {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
};

type ToastContextType = {
  toast: (opts: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ToastOptions | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback(
    (opts: ToastOptions) => {
      setCurrent(opts);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() =>
          setCurrent(null),
        );
      }, 3500);
    },
    [opacity],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {current && (
        <Animated.View
          style={[
            styles.container,
            { top: insets.top + 8, opacity },
            current.variant === "destructive" ? styles.destructive : styles.default,
          ]}
        >
          <Pressable onPress={() => setCurrent(null)}>
            <Text style={styles.title}>{current.title}</Text>
            {current.description ? <Text style={styles.description}>{current.description}</Text> : null}
          </Pressable>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    right: 12,
    borderRadius: 12,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 1000,
  },
  default: { backgroundColor: colors.primary },
  destructive: { backgroundColor: colors.danger },
  title: { color: "#fff", fontWeight: "600", fontSize: 14 },
  description: { color: "#fff", fontSize: 12, marginTop: 2, opacity: 0.9 },
});
