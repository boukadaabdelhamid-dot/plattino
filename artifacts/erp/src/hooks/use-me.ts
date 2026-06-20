import { useGetMe } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";

export type Role = "admin" | "employee" | "customer";

export function useMe() {
  const { token } = useAuth();
  const { data, isLoading } = useGetMe({
    query: { enabled: !!token, staleTime: 60_000, retry: false },
  });
  const role = (data?.role ?? null) as Role | null;
  return {
    user: data ?? null,
    role,
    isAdmin: role === "admin",
    isEmployee: role === "employee",
    isStaff: role === "admin" || role === "employee",
    isLoading: !!token && isLoading,
  };
}
