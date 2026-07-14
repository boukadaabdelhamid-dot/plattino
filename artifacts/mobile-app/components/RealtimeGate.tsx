import { useAuth } from "@/contexts/auth-context";
import { useRealtimeWS } from "@/hooks/use-realtime-ws";

/**
 * Mounted once at the app root so the WS connection persists across
 * navigation. useRealtimeWS itself no-ops until a token + user are present.
 */
export function RealtimeGate() {
  useAuth();
  useRealtimeWS();
  return null;
}
