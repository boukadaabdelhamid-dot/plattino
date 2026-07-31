import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/contexts/auth-context";
import { useServer } from "@/contexts/server-context";
import { useStoreContext } from "@/contexts/store-context";
import { useMe } from "@/hooks/use-me";
import { usePermissions, type PermSection } from "@/contexts/permissions-context";

/**
 * Mirrors the web ERP's <ProtectedRoute>: redirects unauthenticated/
 * unauthorized users and reports whether the screen should show a loading
 * state while auth/permission data resolves.
 */
export function useProtectedRoute(opts: { section?: PermSection; adminOnly?: boolean } = {}) {
  const router = useRouter();
  const { token, logout } = useAuth();
  const { serverUrl, isServerReady } = useServer();
  const { currentStoreId } = useStoreContext();
  const { isAdmin, isStaff, role, isLoading, user } = useMe();
  const { can, isLoaded: permsLoaded } = usePermissions();

  useEffect(() => {
    if (role === "customer") logout();
  }, [role, logout]);

  const stores = (user as { stores?: unknown[] } | null)?.stores ?? [];

  useEffect(() => {
    // No server configured — send to setup before anything else.
    if (isServerReady && !serverUrl) {
      router.replace("/server-setup");
      return;
    }
    if (!token) {
      router.replace("/login");
      return;
    }
    if (isLoading) return;
    if (user && !isStaff) {
      router.replace("/login");
      return;
    }
    if (!currentStoreId && stores.length > 0) {
      router.replace("/select-store");
      return;
    }
    if (opts.adminOnly && !isAdmin) {
      router.replace("/home");
      return;
    }
    if (opts.section && !isAdmin) {
      if (!permsLoaded) return;
      if (!can(opts.section, "view")) {
        router.replace("/home");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServerReady, serverUrl, token, isLoading, user, isStaff, currentStoreId, stores.length, isAdmin, permsLoaded]);

  const ready =
    !!serverUrl &&
    !!token &&
    !isLoading &&
    (!user || isStaff) &&
    (!!currentStoreId || stores.length === 0) &&
    (!opts.adminOnly || isAdmin) &&
    (!opts.section || isAdmin || permsLoaded);

  return { ready, isAdmin, can };
}
