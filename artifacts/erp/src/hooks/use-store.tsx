import React, { createContext, useContext, useState, useCallback } from "react";
import type { Store } from "@workspace/api-client-react";

const STORE_KEY = "midanic.erp.currentStoreId";

type StoreContextType = {
  currentStoreId: number | null;
  stores: Store[];
  setStores: (stores: Store[], currentStoreId: number | null) => void;
  setCurrentStoreId: (id: number | null) => void;
  clear: () => void;
};

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [stores, setStoresState] = useState<Store[]>([]);
  const [currentStoreId, setCurrentStoreIdState] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = window.localStorage.getItem(STORE_KEY);
    return v ? Number(v) : null;
  });

  const setStores = useCallback((s: Store[], cur: number | null) => {
    setStoresState(s);
    if (cur != null) {
      window.localStorage.setItem(STORE_KEY, String(cur));
      setCurrentStoreIdState(cur);
    }
  }, []);

  const setCurrentStoreId = useCallback((id: number | null) => {
    if (id == null) {
      window.localStorage.removeItem(STORE_KEY);
    } else {
      window.localStorage.setItem(STORE_KEY, String(id));
    }
    setCurrentStoreIdState(id);
  }, []);

  const clear = useCallback(() => {
    window.localStorage.removeItem(STORE_KEY);
    setStoresState([]);
    setCurrentStoreIdState(null);
  }, []);

  return (
    <StoreContext.Provider value={{ currentStoreId, stores, setStores, setCurrentStoreId, clear }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStoreContext() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStoreContext must be used within StoreProvider");
  return ctx;
}
