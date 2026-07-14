import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Token storage abstraction. expo-secure-store is not available on web, so
 * we fall back to localStorage there (mirrors expo-secure-store's polyfill
 * behavior recommended by the Expo skill).
 */
const TOKEN_KEY = "midanic_erp_token";

let memoryToken: string | null = null;

export function getToken(): string | null {
  if (Platform.OS === "web") {
    if (typeof localStorage === "undefined") return memoryToken;
    return localStorage.getItem(TOKEN_KEY);
  }
  return memoryToken;
}

export async function loadTokenAsync(): Promise<string | null> {
  if (Platform.OS === "web") {
    return getToken();
  }
  const value = await SecureStore.getItemAsync(TOKEN_KEY);
  memoryToken = value;
  return value;
}

export async function saveToken(token: string): Promise<void> {
  memoryToken = token;
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  memoryToken = null;
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
