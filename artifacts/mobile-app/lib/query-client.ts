import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { forceLogout } from "@/contexts/auth-context";

function is401(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (is401(error)) forceLogout();
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (is401(error)) forceLogout();
    },
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !is401(error) && failureCount < 1,
      staleTime: 30_000,
    },
  },
});
