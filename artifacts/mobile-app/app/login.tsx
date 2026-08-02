import React, { useState } from "react";
import { View, Text, Image, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useLogin, useSelectStore } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { useStoreContext } from "@/contexts/store-context";
import { useLang } from "@/contexts/lang-context";
import { useLanguageSwitch } from "@/hooks/use-language-switch";
import { useServer } from "@/contexts/server-context";
import { colors } from "@/lib/colors";
import { Button, FormField } from "@/components/ui";

// True when the server URL is fixed by env (e.g. development builds) — hide the change-server link.
const ENV_LOCKED = !!process.env.EXPO_PUBLIC_API_URL;

export default function Login() {
  const router = useRouter();
  const { setToken } = useAuth();
  const { setStores, clear } = useStoreContext();
  const { t, lang } = useLang();
  const { toggleLanguage } = useLanguageSwitch();
  const { clearServerUrl } = useServer();
  const loginMutation = useLogin();
  const selectStore = useSelectStore();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    setError(null);
    if (!email || password.length < 4) {
      setError(t("Identifiants invalides", "بيانات غير صحيحة"));
      return;
    }
    loginMutation.mutate(
      { data: { email: email.trim().toLowerCase(), password } },
      {
        onSuccess: async (res) => {
          if (res.user?.role === "customer") {
            setError(
              t(
                "Accès non autorisé — compte client. Cet espace est réservé au personnel.",
                "وصول غير مصرّح — حساب عميل. هذه المساحة مخصّصة للموظفين فقط.",
              ),
            );
            return;
          }
          await setToken(res.token);
          clear();
          const stores = res.stores ?? [];
          if (res.currentStoreId != null) {
            setStores(stores, res.currentStoreId);
            router.replace("/home");
          } else if (stores.length === 0) {
            router.replace("/home");
          } else if (stores.length === 1) {
            selectStore.mutate(
              { data: { storeId: stores[0].id } },
              {
                onSuccess: async (sres) => {
                  await setToken(sres.token);
                  setStores(stores, sres.currentStoreId);
                  router.replace("/home");
                },
                onError: () => {
                  setStores(stores, stores[0].id);
                  router.replace("/home");
                },
              },
            );
          } else {
            setStores(stores, null);
            router.replace("/select-store");
          }
        },
        onError: () => {
          setError(t("Identifiants invalides", "بيانات غير صحيحة"));
        },
      },
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Image
          source={require("../assets/images/icon.png")}
          style={styles.logo}
          resizeMode="cover"
        />
        <Text style={styles.title}>Midanic</Text>
        <Text style={styles.subtitle}>{t("Espace personnel", "المساحة الإدارية")}</Text>

        <View style={{ marginTop: 24, width: "100%" }}>
          <FormField
            label={t("Email", "البريد الإلكتروني")}
            value={email}
            onChangeText={setEmail}
            placeholder="nom@midanic.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
          />
          <FormField
            label={t("Mot de passe", "كلمة المرور")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label={loginMutation.isPending ? t("Connexion...", "جارٍ الدخول...") : t("Se connecter", "تسجيل الدخول")}
            onPress={onSubmit}
            loading={loginMutation.isPending}
            testID="button-login"
          />
        </View>

        <Button
          label={lang === "ar" ? "Français" : "العربية"}
          onPress={toggleLanguage}
          variant="ghost"
          style={{ marginTop: 16 }}
        />

        {!ENV_LOCKED ? (
          <Button
            label={t("Changer de serveur", "تغيير عنوان السيرفر")}
            onPress={async () => {
              await clearServerUrl();
              router.replace("/server-setup");
            }}
            variant="ghost"
            style={{ marginTop: 4 }}
            testID="button-change-server"
          />
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", padding: 20 },
  card: { width: "100%", maxWidth: 400, backgroundColor: colors.surface, borderRadius: 20, padding: 28, alignItems: "center" },
  logo: { width: 72, height: 72, borderRadius: 16, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: "700", color: colors.primary },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 10, textAlign: "center" },
});
