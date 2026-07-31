import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getActiveBaseUrl } from "@/lib/api";
import { getToken } from "@/lib/auth-storage";
import { getGetMeQueryKey } from "@workspace/api-client-react";

/**
 * A handful of admin endpoints exist on the api-server but were never wired
 * into the orval-generated hooks (the web ERP itself calls them via raw
 * `fetch()` rather than a generated client — see erp/src/pages/Permissions.tsx
 * and Settings.tsx). Mobile mirrors that same approach here instead of
 * inventing a new backend surface: GET/PUT /erp/permissions/:userId and
 * PUT /auth/me + /auth/me/password.
 */
async function authedFetch(path: string, init?: RequestInit) {
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
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.error || body?.message || message;
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export type PermRow = { section: string; action: string; granted: boolean };

export function useStaffPermissions(userId: number | null) {
  return useQuery<PermRow[]>({
    queryKey: ["erp-permissions", userId],
    queryFn: () => authedFetch(`/api/erp/permissions/${userId}`),
    enabled: userId != null,
  });
}

export function useSaveStaffPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, perms }: { userId: number; perms: PermRow[] }) =>
      authedFetch(`/api/erp/permissions/${userId}`, {
        method: "PUT",
        body: JSON.stringify(perms),
      }),
    onSuccess: (_data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: ["erp-permissions", userId] });
    },
  });
}

export type ProfileUpdateBody = {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
};

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProfileUpdateBody) =>
      authedFetch(`/api/auth/me`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (data: { currentPassword: string; newPassword: string }) =>
      authedFetch(`/api/auth/me/password`, { method: "PUT", body: JSON.stringify(data) }),
  });
}

/** Shared section/action metadata mirroring the web ERP's Permissions grid. */
export const PERMISSION_SECTIONS: { key: string; fr: string; ar: string }[] = [
  { key: "dashboard", fr: "Tableau de bord", ar: "لوحة التحكم" },
  { key: "orders", fr: "Ventes", ar: "المبيعات" },
  { key: "caisse", fr: "Caisse", ar: "الصندوق" },
  { key: "products", fr: "Articles", ar: "المنتجات" },
  { key: "purchases", fr: "Achats", ar: "المشتريات" },
  { key: "suppliers", fr: "Fournisseurs", ar: "الموردون" },
  { key: "inventory", fr: "Stock", ar: "المخزون" },
  { key: "customers", fr: "Clients", ar: "العملاء" },
  { key: "employees", fr: "Employés", ar: "الموظفون" },
  { key: "attendance", fr: "Présences", ar: "الحضور" },
  { key: "leaves", fr: "Congés", ar: "الإجازات" },
  { key: "accounting", fr: "Comptabilité", ar: "المحاسبة" },
  { key: "realtime", fr: "Temps réel", ar: "الوقت الفعلي" },
  { key: "settings", fr: "Paramètres", ar: "الإعدادات" },
];

export const PERMISSION_ACTIONS: { key: "view" | "create" | "edit" | "delete"; fr: string; ar: string }[] = [
  { key: "view", fr: "Voir", ar: "عرض" },
  { key: "create", fr: "Créer", ar: "إضافة" },
  { key: "edit", fr: "Modifier", ar: "تعديل" },
  { key: "delete", fr: "Supprimer", ar: "حذف" },
];

export function buildPermMap(rows: PermRow[]): Map<string, boolean> {
  const m = new Map<string, boolean>();
  PERMISSION_SECTIONS.forEach((s) =>
    PERMISSION_ACTIONS.forEach((a) => m.set(`${s.key}:${a.key}`, false)),
  );
  rows.forEach((r) => m.set(`${r.section}:${r.action}`, r.granted));
  return m;
}

export function mapToPermRows(map: Map<string, boolean>): PermRow[] {
  const rows: PermRow[] = [];
  PERMISSION_SECTIONS.forEach((s) =>
    PERMISSION_ACTIONS.forEach((a) => {
      rows.push({ section: s.key, action: a.key, granted: map.get(`${s.key}:${a.key}`) ?? false });
    }),
  );
  return rows;
}
