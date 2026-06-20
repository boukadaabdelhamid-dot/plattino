// @refresh reset
import React, { createContext, useContext, useEffect, useState } from "react";
import { useGetMe, getGetMeQueryKey, type User, setAuthTokenGetter, setExtraHeadersGetter } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

setAuthTokenGetter(() => {
  return localStorage.getItem("midanic_token");
});

// Resolve store slug from URL (?store=) or persisted localStorage and send
// it as X-Store-Slug on every request so the storefront stays scoped.
setExtraHeadersGetter(() => {
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("store");
    if (fromQuery) {
      localStorage.setItem("midanic_store_slug", fromQuery);
      return { "X-Store-Slug": fromQuery };
    }
    const stored = localStorage.getItem("midanic_store_slug");
    return stored ? { "X-Store-Slug": stored } : null;
  } catch {
    return null;
  }
});

type AuthContextType = {
  user: User | undefined;
  isLoading: boolean;
  logout: () => void;
  setToken: (token: string) => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setTokenState] = useState<string | null>(localStorage.getItem("midanic_token"));

  const { data: user, isLoading } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      queryKey: getGetMeQueryKey(),
    },
  });

  const setToken = (newToken: string) => {
    localStorage.setItem("midanic_token", newToken);
    setTokenState(newToken);
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  const logout = () => {
    localStorage.removeItem("midanic_token");
    setTokenState(null);
    queryClient.setQueryData(getGetMeQueryKey(), null);
  };

  useEffect(() => {
    if (token) {
      localStorage.setItem("midanic_token", token);
    } else {
      localStorage.removeItem("midanic_token");
    }
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, isLoading, logout, setToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
