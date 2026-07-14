import { useEffect } from "react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/contexts/auth-context";
import { LoadingView } from "@/components/ui";

export default function Index() {
  const router = useRouter();
  const { token, isReady } = useAuth();

  useEffect(() => {
    if (!isReady) return;
    router.replace(token ? "/home" : "/login");
  }, [isReady, token, router]);

  return (
    <View style={{ flex: 1 }}>
      <LoadingView />
    </View>
  );
}
