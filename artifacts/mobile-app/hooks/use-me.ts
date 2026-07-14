import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";

export type Role = "admin" | "employee" | "customer";

export function useMe() {
  const { token } = useAuth();
  const { data, isLoading, refetch } = useGetMe({
    query: { enabled: !!token, staleTime: 60_000, retry: false, queryKey: getGetMeQueryKey() },
  });
  const role = (data?.role ?? null) as Role | null;
  return {
    user: data ?? null,
    role,
    isAdmin: role === "admin",
    isEmployee: role === "employee",
    isStaff: role === "admin" || role === "employee",
    isLoading: !!token && isLoading,
    refetch,
  };
}
