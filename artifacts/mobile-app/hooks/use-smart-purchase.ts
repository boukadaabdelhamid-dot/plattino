/**
 * Hooks for the Smart Purchase / Besoin d'achat module.
 * All backed by raw fetch (endpoints not in orval-generated client).
 */
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { getActiveBaseUrl } from "@/lib/api";
import { getToken } from "@/lib/auth-storage";

export async function erpFetch(path: string, init?: RequestInit) {
  const token = getToken();
  const res = await fetch(`${getActiveBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, unknown>).error as string || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type NeededRow = {
  id: number;
  designation: string;
  designation_ar: string;
  image_url: string | null;
  stock: number;
  min_stock: number | null;
  cost_price: string | null;
  price: string | null;
  reference: string | null;
  famille: string | null;
  famille_ar: string | null;
  marque: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_city: string | null;
  supplier_phone: string | null;
  benefice: number;
  total_qty_sold: number;
};

export type NeededResponse = {
  rows: NeededRow[];
  ruptureTotal: number;
  lowTotal: number;
};

export type FilterOptions = {
  families: { id: number; nameFr: string; nameAr: string }[];
  brands:   { id: number; nameFr: string; nameAr: string }[];
  supplierCities: string[];
};

export type PurchaseSuggestion = {
  id: number;
  product_name: string;
  image_url: string | null;
  notes: string | null;
  market_price: string | null;
  demand_count: number;
  staff_id: number;
  staff_name: string | null;
  created_at: string;
};

export type HistoryRow = {
  po_id: number;
  received_date: string;
  supplier_name: string;
  supplier_address: string | null;
  supplier_phone: string | null;
  unit_cost: number;
  quantity: number;
  image_url: string | null;
  product_name: string;
  product_name_ar: string;
};

export type DraftPO = {
  id: number;
  supplierId: number | null;
  paymentMethod: "comptant" | "a_terme";
  notes: string | null;
  status: string;
  totalAmount: string;
  createdAt: string;
};

export type POItem = {
  productId: number;
  quantity: number;
  unitCost: string | number;
};

export type NeededFilters = {
  search?: string;
  stockFilter?: "all" | "rupture" | "low";
  sortBy?: "profit" | "qty_sold";
  supplierId?: number | null;
  familyId?: number | null;
  brandId?: number | null;
  supplierCity?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

// ─── Needed products (infinite) ───────────────────────────────────────────────

const PAGE_LIMIT = 10;

function buildNeededUrl(filters: NeededFilters, offset: number): string {
  const p = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(offset) });
  if (filters.search)       p.set("search",       filters.search);
  if (filters.stockFilter && filters.stockFilter !== "all") p.set("stockFilter", filters.stockFilter);
  if (filters.sortBy     && filters.sortBy     !== "profit") p.set("sortBy",  filters.sortBy);
  if (filters.supplierId) p.set("supplierId",  String(filters.supplierId));
  if (filters.familyId)   p.set("familyId",    String(filters.familyId));
  if (filters.brandId)    p.set("brandId",     String(filters.brandId));
  if (filters.supplierCity) p.set("supplierCity", filters.supplierCity);
  if (filters.dateFrom)   p.set("dateFrom",    filters.dateFrom);
  if (filters.dateTo)     p.set("dateTo",      filters.dateTo);
  return `/api/erp/purchases/needed?${p}`;
}

export function useNeededProducts(filters: NeededFilters, enabled: boolean) {
  return useInfiniteQuery<NeededResponse>({
    queryKey: ["purchases-needed", filters],
    queryFn: ({ pageParam }) =>
      erpFetch(buildNeededUrl(filters, (pageParam as number) ?? 0)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.rows.length < PAGE_LIMIT) return undefined;
      return allPages.reduce((sum, p) => sum + p.rows.length, 0);
    },
    enabled,
    staleTime: 30_000,
  });
}

// ─── Filter options ────────────────────────────────────────────────────────────

export function useFilterOptions(enabled: boolean) {
  return useQuery<FilterOptions>({
    queryKey: ["purchases-filter-options"],
    queryFn: () => erpFetch("/api/erp/purchases/filter-options"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

// ─── Purchase history ─────────────────────────────────────────────────────────

export function usePurchaseHistory(productId: number | null, enabled: boolean) {
  return useQuery<HistoryRow[]>({
    queryKey: ["purchase-history", productId],
    queryFn: () => erpFetch(`/api/erp/purchases/history/${productId}`),
    enabled: enabled && productId != null,
    staleTime: 60_000,
  });
}

// ─── Snooze / Exclude ─────────────────────────────────────────────────────────

export function useSnoozeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: number) =>
      erpFetch(`/api/erp/purchases/snooze/${productId}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchases-needed"] }),
  });
}

export function useExcludeProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: number) =>
      erpFetch(`/api/erp/purchases/exclude/${productId}`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchases-needed"] }),
  });
}

// ─── Inline min-stock patch ───────────────────────────────────────────────────

export function usePatchProductMinStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, minStock }: { productId: number; minStock: number | null }) =>
      erpFetch(`/api/products/${productId}`, {
        method: "PUT",
        body: JSON.stringify({ minStock }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchases-needed"] }),
  });
}

// ─── Draft POs ────────────────────────────────────────────────────────────────

export function useDraftPOs(enabled: boolean) {
  return useQuery<DraftPO[]>({
    queryKey: ["draft-purchase-orders"],
    queryFn: async () => {
      const json = await erpFetch("/api/erp/purchase-orders?status=pending&limit=500") as { data: DraftPO[] };
      return json.data ?? [];
    },
    enabled,
    staleTime: 30_000,
  });
}

// ─── Quick order: new PO ──────────────────────────────────────────────────────

export function useQuickOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      supplierId: number;
      items: { productId: number; quantity: number; unitCost: number }[];
      paymentMethod: "comptant" | "a_terme";
    }) =>
      erpFetch("/api/erp/purchase-orders", {
        method: "POST",
        body: JSON.stringify({ ...body, notes: "" }),
      }) as Promise<{ id: number }>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["draft-purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchases-needed"] });
    },
  });
}

// ─── Quick order: add to existing PO ─────────────────────────────────────────

export function useAddToPO() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      poId,
      po,
      newItem,
    }: {
      poId: number;
      po: { supplierId: number; paymentMethod: "comptant" | "a_terme"; notes: string | null };
      newItem: { productId: number; quantity: number; unitCost: number };
    }) => {
      const existingItems: POItem[] = await erpFetch(`/api/erp/purchase-orders/${poId}/items`);
      let merged = false;
      const allItems = existingItems.map((i) => {
        if (i.productId === newItem.productId) {
          merged = true;
          return { productId: i.productId, quantity: Number(i.quantity) + newItem.quantity, unitCost: newItem.unitCost };
        }
        return { productId: i.productId, quantity: Number(i.quantity), unitCost: Number(i.unitCost) };
      });
      if (!merged) allItems.push(newItem);
      await erpFetch(`/api/erp/purchase-orders/${poId}`, {
        method: "PUT",
        body: JSON.stringify({ supplierId: po.supplierId, items: allItems, paymentMethod: po.paymentMethod, notes: po.notes ?? "" }),
      });
      return { id: poId, itemCount: allItems.length, merged };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["draft-purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["purchases-needed"] });
    },
  });
}

// ─── All suppliers (for quick-order sheet) ───────────────────────────────────

export type SupplierRow = {
  id: number;
  name: string;
  city: string | null;
  phone: string | null;
};

export function useSuppliersAll(enabled: boolean) {
  return useQuery<SupplierRow[]>({
    queryKey: ["suppliers-all"],
    queryFn: async () => {
      const json = await erpFetch("/api/erp/suppliers?limit=500") as { data: SupplierRow[] };
      return json.data ?? [];
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

// ─── Purchase suggestions ──────────────────────────────────────────────────────

export function usePurchaseSuggestions(enabled: boolean) {
  return useQuery<PurchaseSuggestion[]>({
    queryKey: ["purchase-suggestions"],
    queryFn: () => erpFetch("/api/erp/purchase-suggestions"),
    enabled,
  });
}

export function useCreateSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { product_name: string; notes?: string; market_price?: string; image_url?: string }) =>
      erpFetch("/api/erp/purchase-suggestions", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-suggestions"] }),
  });
}

export function usePatchSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; product_name?: string; notes?: string; market_price?: string; image_url?: string }) =>
      erpFetch(`/api/erp/purchase-suggestions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-suggestions"] }),
  });
}

export function useDeleteSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      erpFetch(`/api/erp/purchase-suggestions/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-suggestions"] }),
  });
}

export function useTapSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      erpFetch(`/api/erp/purchase-suggestions/${id}/tap`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-suggestions"] }),
  });
}
