import "react-native-gesture-handler";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { configureApiClient } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { LangProvider } from "@/contexts/lang-context";
import { ServerProvider } from "@/contexts/server-context";
import { AuthProvider, registerForceLogout } from "@/contexts/auth-context";
import { StoreProvider } from "@/contexts/store-context";
import { PermissionsProvider } from "@/contexts/permissions-context";
import { ToastProvider } from "@/contexts/toast-context";
import { ConfirmProvider } from "@/contexts/confirm-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RealtimeGate } from "@/components/RealtimeGate";

// Initial client setup — uses env var or in-memory cached URL.
// ServerProvider will call reconfigureApiClient() once the stored URL is loaded.
configureApiClient();

function ForceLogoutWiring() {
  const router = useRouter();
  useEffect(() => {
    registerForceLogout(() => router.replace("/login"));
  }, [router]);
  return null;
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <LangProvider>
            <QueryClientProvider client={queryClient}>
              <ServerProvider>
                <AuthProvider>
                  <StoreProvider>
                    <PermissionsProvider>
                      <ToastProvider>
                        <ConfirmProvider>
                          <ForceLogoutWiring />
                          <RealtimeGate />
                          <StatusBar style="dark" />
                          <Stack screenOptions={{ headerShown: false }}>
                            <Stack.Screen name="index" />
                            <Stack.Screen name="server-setup" />
                            <Stack.Screen name="login" />
                            <Stack.Screen name="select-store" />
                            <Stack.Screen name="(app)" />
                          </Stack>
                        </ConfirmProvider>
                      </ToastProvider>
                    </PermissionsProvider>
                  </StoreProvider>
                </AuthProvider>
              </ServerProvider>
            </QueryClientProvider>
          </LangProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
