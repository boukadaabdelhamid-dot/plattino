// @refresh reset
import React, { createContext, useContext, useState, useEffect } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

setAuthTokenGetter(() => localStorage.getItem("midanic_token"));

const STORE_KEY = "midanic.erp.currentStoreId";

/** Call this from outside React components (e.g. QueryClient error handler) */
export function forceLogout() {
  localStorage.removeItem("midanic_token");
  localStorage.removeItem(STORE_KEY);
  window.location.href = `${import.meta.env.BASE_URL}login`.replace(/\/+/g, "/");
}

type AuthContextType = {
  token: string | null;
  setToken: (t: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(
    localStorage.getItem("midanic_token")
  );

  const setToken = (t: string) => {
    localStorage.setItem("midanic_token", t);
    setTokenState(t);
  };

  const logout = () => {
    localStorage.removeItem("midanic_token");
    localStorage.removeItem(STORE_KEY);
    setTokenState(null);
  };

  useEffect(() => {
    if (!token) localStorage.removeItem("midanic_token");
  }, [token]);

  return (
    <AuthContext.Provider value={{ token, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
