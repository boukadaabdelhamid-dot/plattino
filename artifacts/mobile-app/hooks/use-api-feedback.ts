import { useToast } from "@/contexts/toast-context";
import { useLang } from "@/contexts/lang-context";
import { getErrorMessage } from "@/lib/error";

/**
 * Shared mutation-feedback pattern: call `.success(...)` in a mutation's
 * `onSuccess` and `.error(...)` in its `onError` so every write-action form
 * across the app surfaces consistent toasts, mirroring the web ERP's
 * `useToast()` usage.
 *
 * Example:
 *   const feedback = useApiFeedback();
 *   createOrder.mutate(payload, {
 *     onSuccess: () => feedback.success("Commande créée", "تم إنشاء الطلب"),
 *     onError: (e) => feedback.error(e),
 *   });
 */
export function useApiFeedback() {
  const { toast } = useToast();
  const { t } = useLang();

  return {
    success(frTitle: string, arTitle: string, frDescription?: string, arDescription?: string) {
      toast({
        title: t(frTitle, arTitle),
        description: frDescription != null ? t(frDescription, arDescription ?? frDescription) : undefined,
        variant: "default",
      });
    },
    error(error: unknown, frFallback = "Une erreur est survenue", arFallback = "حدث خطأ") {
      toast({
        title: t("Erreur", "خطأ"),
        description: getErrorMessage(error, t(frFallback, arFallback)),
        variant: "destructive",
      });
    },
  };
}
