import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Store } from "@workspace/api-client-react";

const STORE_KEY = "midanic.erp.currentStoreId";

type StoreContextType = {
  currentStoreId: number | null;
  stores: Store[];
  isReady: boolean;
  setStores: (stores: Store[], currentStoreId: number | null) => void;
  setCurrentStoreId: (id: number | null) => void;
  clear: () => void;
};

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [stores, setStoresState] = useState<Store[]>([]);
  const [currentStoreId, setCurrentStoreIdState] = useState<number | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      const v = await AsyncStorage.getItem(STORE_KEY);
      if (v) setCurrentStoreIdState(Number(v));
      setIsReady(true);
    })();
  }, []);

  const setStores = useCallback((s: Store[], cur: number | null) => {
    setStoresState(s);
    if (cur != null) {
      AsyncStorage.setItem(STORE_KEY, String(cur));
      setCurrentStoreIdState(cur);
    }
  }, []);

  const setCurrentStoreId = useCallback((id: number | null) => {
    if (id == null) {
      AsyncStorage.removeItem(STORE_KEY);
    } else {
      AsyncStorage.setItem(STORE_KEY, String(id));
    }
    setCurrentStoreIdState(id);
  }, []);

  const clear = useCallback(() => {
    AsyncStorage.removeItem(STORE_KEY);
    setStoresState([]);
    setCurrentStoreIdState(null);
  }, []);

  return (
    <StoreContext.Provider
      value={{ currentStoreId, stores, isReady, setStores, setCurrentStoreId, clear }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStoreContext(): StoreContextType {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStoreContext must be used within StoreProvider");
  return ctx;
}
