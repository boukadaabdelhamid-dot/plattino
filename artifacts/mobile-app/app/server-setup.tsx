import React, { useState } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useServer } from "@/contexts/server-context";
import { useLang } from "@/contexts/lang-context";
import { colors } from "@/lib/colors";
import { Button, FormField } from "@/components/ui";

/** Normalise raw user input into a clean https:// URL. */
function normaliseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!url) return "";
  // Prepend https:// if no protocol given
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

/** Attempt to reach the server — resolves true on any HTTP response, false on
 *  network errors or timeouts. */
async function pingServer(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    // HEAD on root — api-server responds with 404 but still proves connectivity.
    await fetch(`${url}/`, { method: "HEAD", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default function ServerSetup() {
  const router = useRouter();
  const { setServerUrl } = useServer();
  const { t } = useLang();

  const [urlInput, setUrlInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const onConnect = async () => {
    setError(null);
    const url = normaliseUrl(urlInput);
    if (!url) {
      setError(t("Veuillez saisir une adresse serveur.", "الرجاء إدخال رابط الخادم."));
      return;
    }

    setChecking(true);
    const reachable = await pingServer(url);
    setChecking(false);

    if (!reachable) {
      setError(
        t(
          "Impossible de joindre ce serveur. Vérifiez l'adresse et votre connexion.",
          "تعذّر الاتصال بهذا الخادم. تحقق من الرابط واتصالك بالإنترنت.",
        ),
      );
      return;
    }

    await setServerUrl(url);
    router.replace("/login");
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
        <Text style={styles.subtitle}>
          {t("Configurer le serveur ERP", "إعداد خادم ERP")}
        </Text>

        <Text style={styles.hint}>
          {t(
            "Saisissez l'adresse (URL) de votre serveur ERP API.",
            "أدخل رابط خادم ERP الخاص بك.",
          )}
        </Text>

        <View style={{ marginTop: 16, width: "100%" }}>
          <FormField
            label={t("Adresse du serveur", "رابط الخادم")}
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="https://api.example.com"
            keyboardType="default"
            autoCapitalize="none"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {checking ? (
            <View style={styles.checkingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.checkingText}>
                {t("Vérification en cours…", "جارٍ التحقق…")}
              </Text>
            </View>
          ) : (
            <Button
              label={t("Se connecter", "اتصال")}
              onPress={onConnect}
              loading={checking}
            />
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
  },
  logo: { width: 72, height: 72, borderRadius: 16, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: "700", color: colors.primary },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  hint: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 16,
    textAlign: "center",
    lineHeight: 19,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginBottom: 10,
    textAlign: "center",
  },
  checkingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
  },
  checkingText: { fontSize: 13, color: colors.textMuted },
});
