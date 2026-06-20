import React, { createContext, useContext, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export type StoreConfig = {
  nameAr: string;
  nameEn: string;
  logoUrl: string | null;
  showPrices: boolean;
  showStock: boolean;
  acceptOrders: boolean;
  minOrderAmount: number;
  bannerUrl: string | null;
  description: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  whatsappNumber: string | null;
  featuredProductIds: number[];
  featuredCategoryIds: number[];
};

const SAFE_DEFAULTS: StoreConfig = {
  nameAr: "ميدانيك",
  nameEn: "Midanic",
  logoUrl: null,
  showPrices: true,
  showStock: true,
  acceptOrders: true,
  minOrderAmount: 0,
  bannerUrl: null,
  description: null,
  facebookUrl: null,
  instagramUrl: null,
  tiktokUrl: null,
  whatsappNumber: null,
  featuredProductIds: [],
  featuredCategoryIds: [],
};

const StoreConfigContext = createContext<StoreConfig>(SAFE_DEFAULTS);

function getSlug(): string {
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("store");
    if (fromQuery) return fromQuery;
    return (
      localStorage.getItem("midanic_store_slug") ??
      (import.meta.env.VITE_STORE_SLUG as string | undefined) ??
      "principal"
    );
  } catch {
    return (import.meta.env.VITE_STORE_SLUG as string | undefined) ?? "principal";
  }
}

export function StoreConfigProvider({ children }: { children: React.ReactNode }) {
  const slug = getSlug();

  const { data } = useQuery<StoreConfig>({
    queryKey: ["store-config", slug],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/stores/${encodeURIComponent(slug)}/config`);
      if (!res.ok) return SAFE_DEFAULTS;
      const json = await res.json();
      return {
        nameAr: json.nameAr ?? "ميدانيك",
        nameEn: json.nameEn ?? "Midanic",
        logoUrl: json.logoUrl ?? null,
        showPrices: json.showPrices ?? true,
        showStock: json.showStock ?? true,
        acceptOrders: json.acceptOrders ?? true,
        minOrderAmount: Number(json.minOrderAmount ?? 0),
        bannerUrl: json.bannerUrl ?? null,
        description: json.description ?? null,
        facebookUrl: json.facebookUrl ?? null,
        instagramUrl: json.instagramUrl ?? null,
        tiktokUrl: json.tiktokUrl ?? null,
        whatsappNumber: json.whatsappNumber ?? null,
        featuredProductIds: Array.isArray(json.featuredProductIds) ? json.featuredProductIds : [],
        featuredCategoryIds: Array.isArray(json.featuredCategoryIds) ? json.featuredCategoryIds : [],
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const config = useMemo(() => data ?? SAFE_DEFAULTS, [data]);

  return (
    <StoreConfigContext.Provider value={config}>
      {children}
    </StoreConfigContext.Provider>
  );
}

export function useStoreConfig(): StoreConfig {
  return useContext(StoreConfigContext);
}
