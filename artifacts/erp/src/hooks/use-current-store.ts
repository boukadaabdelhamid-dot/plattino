import { useGetErpStoresMine, type Store } from "@workspace/api-client-react";
import { useStoreContext } from "./use-store";

/**
 * Returns the full Store object (with profile fields like address/logoUrl/tvaRate)
 * for the user's currently active store. Uses the staff-safe `/erp/stores/mine`
 * endpoint so non-admin employees can also retrieve store profile/branding for
 * invoice printing.
 */
export function useCurrentStore(): Store | null {
  const { currentStoreId } = useStoreContext();
  const { data: stores } = useGetErpStoresMine();
  if (!currentStoreId || !stores) return null;
  return stores.find((s) => s.id === currentStoreId) ?? null;
}
