import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { router } from "expo-router";
import { getToken, loadTokenAsync, saveToken, clearToken } from "@/lib/auth-storage";

type AuthContextType = {
  token: string | null;
  isReady: boolean;
  setToken: (t: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken());
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      const t = await loadTokenAsync();
      setTokenState(t);
      setIsReady(true);
    })();
  }, []);

  const setToken = useCallback(async (t: string) => {
    await saveToken(t);
    setTokenState(t);
  }, []);

  const logout = useCallback(async () => {
    await clearToken();
    setTokenState(null);
    router.replace("/login");
  }, []);

  return (
    <AuthContext.Provider value={{ token, isReady, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Call this from outside React components (e.g. QueryClient error handler). */
let forceLogoutRef: (() => void) | null = null;
export function registerForceLogout(fn: () => void) {
  forceLogoutRef = fn;
}
export function forceLogout() {
  forceLogoutRef?.();
}
