import Constants from "expo-constants";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { getToken } from "./auth-storage";

/**
 * The mobile app talks to the same api-server used by the ERP web app.
 *
 * EXPO_PUBLIC_API_URL is inlined at bundle time by Metro (same mechanism the
 * ERP/web-store vite configs use for VITE_API_URL) — see the "web" script in
 * package.json / the mobile-app workflow, which sets it from
 * REPLIT_DEV_DOMAIN in development. In production, set EXPO_PUBLIC_API_URL
 * to the deployed api-server URL.
 */
function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  // Fallback for native Expo Go sessions without the env var set (e.g. LAN
  // debugging) — reuse the Metro dev server's host with the api-server port.
  const hostUri = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    return `http://${host}:8080`;
  }

  return "http://localhost:8080";
}

export const API_BASE_URL = resolveApiBaseUrl();

export function configureApiClient() {
  setBaseUrl(API_BASE_URL);
  setAuthTokenGetter(() => getToken());
}

export function buildWsUrl(token: string): string {
  const base = API_BASE_URL.replace(/^http/, "ws");
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}
