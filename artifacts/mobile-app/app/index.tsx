import { useEffect } from "react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/contexts/auth-context";
import { useServer } from "@/contexts/server-context";
import { LoadingView } from "@/components/ui";

export default function Index() {
  const router = useRouter();
  const { token, isReady: authReady } = useAuth();
  const { serverUrl, isServerReady } = useServer();

  useEffect(() => {
    if (!isServerReady || !authReady) return;

    // If no server is configured (and no env override), ask the user to set one.
    if (!serverUrl) {
      router.replace("/server-setup");
      return;
    }

    router.replace(token ? "/home" : "/login");
  }, [isServerReady, authReady, serverUrl, token, router]);

  return (
    <View style={{ flex: 1 }}>
      <LoadingView />
    </View>
  );
}
