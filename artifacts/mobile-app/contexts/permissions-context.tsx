import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useMe } from "@/hooks/use-me";
import { useStoreContext } from "@/contexts/store-context";
import { getActiveBaseUrl } from "@/lib/api";
import { getToken } from "@/lib/auth-storage";

export type PermSection =
  | "dashboard"
  | "orders"
  | "products"
  | "inventory"
  | "customers"
  | "purchases"
  | "settings"
  | "caisse"
  | "suppliers"
  | "employees"
  | "realtime"
  | "attendance"
  | "leaves"
  | "accounting";
export type PermAction = "view" | "create" | "edit" | "delete";

export type PermRow = { section: string; action: string; granted: boolean };

interface PermContextType {
  can: (section: PermSection, action: PermAction) => boolean;
  rawPerms: PermRow[];
  isLoaded: boolean;
  refetch: () => void;
}

const PermContext = createContext<PermContextType>({
  can: () => false,
  rawPerms: [],
  isLoaded: false,
  refetch: () => {},
});

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const { isAdmin, isLoading: meLoading } = useMe();
  const { currentStoreId } = useStoreContext();
  const [rawPerms, setRawPerms] = useState<PermRow[]>([]);
  const [permMap, setPermMap] = useState<Map<string, boolean>>(new Map());
  const [isLoaded, setIsLoaded] = useState(false);

  const fetchPerms = useCallback(async () => {
    if (!token || meLoading) return;
    if (isAdmin) {
      setIsLoaded(true);
      return;
    }
    if (!currentStoreId) return;
    try {
      const authToken = getToken();
      const res = await fetch(`${getActiveBaseUrl()}/api/erp/permissions/me`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) { setIsLoaded(true); return; }
      const rows: PermRow[] = await res.json();
      const map = new Map<string, boolean>();
      rows.forEach((r) => map.set(`${r.section}:${r.action}`, r.granted));
      setRawPerms(rows);
      setPermMap(map);
      setIsLoaded(true);
    } catch {
      setIsLoaded(true);
    }
  }, [token, isAdmin, meLoading, currentStoreId]);

  useEffect(() => {
    setIsLoaded(false);
    fetchPerms();
  }, [fetchPerms]);

  const can = useCallback(
    (section: PermSection, action: PermAction): boolean => {
      if (isAdmin) return true;
      return permMap.get(`${section}:${action}`) ?? false;
    },
    [isAdmin, permMap],
  );

  return (
    <PermContext.Provider value={{ can, rawPerms, isLoaded, refetch: fetchPerms }}>
      {children}
    </PermContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermContext);
}
