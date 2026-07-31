import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Server URL storage — persists the user-configured API base URL.
 * Not sensitive (just a URL), but uses the same SecureStore pattern
 * as auth-storage for consistency and synchronous in-memory reads.
 */
const SERVER_URL_KEY = "midanic_erp_server_url";

let memoryServerUrl: string | null = null;

export function getServerUrl(): string | null {
  if (Platform.OS === "web") {
    if (typeof localStorage === "undefined") return memoryServerUrl;
    return localStorage.getItem(SERVER_URL_KEY);
  }
  return memoryServerUrl;
}

export async function loadServerUrlAsync(): Promise<string | null> {
  if (Platform.OS === "web") {
    return getServerUrl();
  }
  const value = await SecureStore.getItemAsync(SERVER_URL_KEY);
  memoryServerUrl = value;
  return value;
}

export async function saveServerUrl(url: string): Promise<void> {
  memoryServerUrl = url;
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.setItem(SERVER_URL_KEY, url);
    return;
  }
  await SecureStore.setItemAsync(SERVER_URL_KEY, url);
}

export async function clearServerUrl(): Promise<void> {
  memoryServerUrl = null;
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.removeItem(SERVER_URL_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(SERVER_URL_KEY);
}
