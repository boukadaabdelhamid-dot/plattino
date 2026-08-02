import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useAuth, forceLogout } from "./use-auth";
import { useMe } from "./use-me";
import { useStoreContext } from "./use-store";

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
  | "accounting"
  | "web_store"
  | "alerts"
  | "transfers";

export type PermAction =
  | "view" | "create" | "edit" | "delete"
  // orders
  | "close" | "print" | "change_payment" | "edit_line_price" | "view_profit"
  // products
  | "edit_price" | "view_purchase_price" | "expose" | "manage_stock"
  | "manage_images" | "manage_barcodes" | "duplicate" | "copy_to_store" | "import"
  | "print_barcode" | "view_history" | "bulk_actions"
  // purchases
  | "receive" | "manage_charges" | "column_settings"
  // settings
  | "edit_store_name" | "edit_default_customer" | "manage_permissions" | "manage_stores"
  // orders – sidebar child visibility
  | "view_sale_orders"
  // inventory
  | "count"
  // customers (granular)
  | "view_balance" | "view_history"
  // web_store
  | "edit_settings" | "manage_featured" | "manage_orders";

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
      const apiBase = ((import.meta.env.VITE_API_URL as string) ?? "").replace(/\/+$/, "");
      const res = await fetch(`${apiBase}/api/erp/permissions/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        // Expired/invalid token — a silent empty-permission state looks like
        // "my permissions disappeared". Force a clean re-login instead.
        forceLogout("expired");
        return;
      }
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
