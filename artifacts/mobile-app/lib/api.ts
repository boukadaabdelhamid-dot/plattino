import Constants from "expo-constants";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { getToken } from "./auth-storage";
import { getServerUrl } from "./server-storage";

/**
 * The mobile app talks to the same api-server used by the ERP web app.
 *
 * URL resolution priority (highest → lowest):
 *  1. EXPO_PUBLIC_API_URL  — bundle-time env var (dev / CI override)
 *  2. _runtimeUrl          — set at runtime by reconfigureApiClient()
 *  3. Metro host fallback  — for LAN Expo Go sessions without env var
 *  4. localhost:8080
 *
 * Use getActiveBaseUrl() everywhere a URL is needed at call-time.
 * Never import the static API_BASE_URL constant in raw fetch() calls.
 */

const ENV_URL: string | null = process.env.EXPO_PUBLIC_API_URL
  ? process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, "")
  : null;

/** Mutable runtime URL — updated by reconfigureApiClient(). */
let _runtimeUrl: string = (() => {
  if (ENV_URL) return ENV_URL;
  const stored = getServerUrl();
  if (stored) return stored;
  const hostUri = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri;
  if (hostUri) return `http://${hostUri.split(":")[0]}:8080`;
  return "http://localhost:8080";
})();

/**
 * Returns the active server URL at call-time.
 * Use this in every raw fetch() call instead of API_BASE_URL.
 */
export function getActiveBaseUrl(): string {
  return _runtimeUrl;
}

/**
 * @deprecated Use getActiveBaseUrl() for call-time resolution.
 * Kept as a bundle-time snapshot for backward compat.
 */
export const API_BASE_URL = _runtimeUrl;

export function configureApiClient() {
  setBaseUrl(_runtimeUrl);
  setAuthTokenGetter(() => getToken());
}

/**
 * Reconfigures ALL request paths to a new server URL.
 * - env override (EXPO_PUBLIC_API_URL) always wins — call is a no-op when set.
 * - Updates the shared orval API client AND the module-level runtime URL used
 *   by raw fetch() calls (permissions, admin-api, sale-orders, WebSocket).
 */
export function reconfigureApiClient(url: string) {
  if (ENV_URL) return; // env override is immutable
  const clean = url.replace(/\/+$/, "");
  _runtimeUrl = clean;
  setBaseUrl(clean);
}

export function buildWsUrl(token: string): string {
  const base = _runtimeUrl.replace(/^http/, "ws");
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}
