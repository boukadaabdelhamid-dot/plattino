import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/**
 * Resolve a stored image URL to an absolute URL.
 * Upload URLs stored in DB are relative (/api/uploads/…) in production;
 * prepend API_BASE so the browser fetches from the API server origin, not
 * the ERP dev port. Absolute URLs (http/https) are returned unchanged.
 */
export function resolveImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return url;
}
