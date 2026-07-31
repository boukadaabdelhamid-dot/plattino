import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  getServerUrl,
  loadServerUrlAsync,
  saveServerUrl,
  clearServerUrl as clearServerUrlStorage,
} from "@/lib/server-storage";
import { reconfigureApiClient } from "@/lib/api";

/**
 * Manages the user-configured ERP server URL.
 *
 * If EXPO_PUBLIC_API_URL is set (dev/CI override), the stored URL is ignored
 * and `serverUrl` is always that env value. No setup screen is shown.
 */

const ENV_URL = process.env.EXPO_PUBLIC_API_URL
  ? process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, "")
  : null;

type ServerContextType = {
  /** The active server URL, or null if not yet configured. */
  serverUrl: string | null;
  /** True once the stored URL has been loaded from persistent storage. */
  isServerReady: boolean;
  /** Save a new server URL and reconfigure the API client immediately. */
  setServerUrl: (url: string) => Promise<void>;
  /** Clear the stored URL (called when the user wants to change servers). */
  clearServerUrl: () => Promise<void>;
};

const ServerContext = createContext<ServerContextType | null>(null);

export function ServerProvider({ children }: { children: React.ReactNode }) {
  // If env override is set, use it directly and mark ready immediately.
  const [serverUrl, setServerUrlState] = useState<string | null>(
    ENV_URL ?? getServerUrl(),
  );
  const [isServerReady, setIsServerReady] = useState(!!ENV_URL);

  useEffect(() => {
    if (ENV_URL) return; // env override — no async load needed
    (async () => {
      const stored = await loadServerUrlAsync();
      if (stored) {
        reconfigureApiClient(stored);
        setServerUrlState(stored);
      }
      setIsServerReady(true);
    })();
  }, []);

  const setServerUrl = useCallback(async (url: string) => {
    if (ENV_URL) return; // env override is immutable — no user change allowed
    const clean = url.trim().replace(/\/+$/, "");
    await saveServerUrl(clean);
    reconfigureApiClient(clean); // updates _runtimeUrl + orval client
    setServerUrlState(clean);
  }, []);

  const clearServerUrl = useCallback(async () => {
    await clearServerUrlStorage();
    setServerUrlState(null);
  }, []);

  return (
    <ServerContext.Provider value={{ serverUrl, isServerReady, setServerUrl, clearServerUrl }}>
      {children}
    </ServerContext.Provider>
  );
}

export function useServer(): ServerContextType {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error("useServer must be used within ServerProvider");
  return ctx;
}
