/**
 * Hooks for the Smart Purchase module:
 *  - useNeededProducts  : GET /api/erp/purchases/needed (paginated, filters)
 *  - useFilterOptions   : GET /api/erp/purchases/filter-options
 *  - usePurchaseSuggestions : GET /api/erp/purchase-suggestions
 *  - useCreateSuggestion / usePatchSuggestion / useDeleteSuggestion / useTapSuggestion
 *
 * All backed by raw fetch (endpoints not in orval-generated client).
 */
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { getActiveBaseUrl } from "@/lib/api";
import { getToken } from "@/lib/auth-storage";

async function erpFetch(path: string, init?: RequestInit) {
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

export type NeededFilters = {
  search?: string;
  stockFilter?: "all" | "rupture" | "low";
  sortBy?: "profit" | "qty_sold";
  supplierId?: number | null;
  familyId?: number | null;
  brandId?: number | null;
  supplierCity?: string | null;
};

// ─── Needed products (infinite) ───────────────────────────────────────────────

const PAGE_LIMIT = 20;

function buildNeededUrl(filters: NeededFilters, offset: number): string {
  const p = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(offset) });
  if (filters.search)                               p.set("search",       filters.search);
  if (filters.stockFilter && filters.stockFilter !== "all") p.set("stockFilter", filters.stockFilter);
  if (filters.sortBy     && filters.sortBy     !== "profit") p.set("sortBy",      filters.sortBy);
  if (filters.supplierId) p.set("supplierId",  String(filters.supplierId));
  if (filters.familyId)   p.set("familyId",    String(filters.familyId));
  if (filters.brandId)    p.set("brandId",     String(filters.brandId));
  if (filters.supplierCity) p.set("supplierCity", filters.supplierCity);
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
    mutationFn: (body: { product_name: string; notes?: string; market_price?: string }) =>
      erpFetch("/api/erp/purchase-suggestions", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["purchase-suggestions"] }),
  });
}

export function usePatchSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; product_name?: string; notes?: string; market_price?: string }) =>
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
