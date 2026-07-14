import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { useLang } from "@/contexts/lang-context";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export type ConfirmOptions = {
  /** French title (required — every confirm needs a title). */
  title: string;
  /** Arabic title. Falls back to `title` when omitted. */
  titleAr?: string;
  message?: string;
  messageAr?: string;
  confirmLabel?: string;
  confirmLabelAr?: string;
  cancelLabel?: string;
  cancelLabelAr?: string;
  /** Renders the confirm button as a danger action (reject/cancel/delete). */
  destructive?: boolean;
};

type ConfirmContextType = {
  /** Imperatively ask the user to confirm an action. Resolves `true`/`false`. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextType | null>(null);

/**
 * App-wide confirm dialog. Mount once near the root; call `useConfirm()`
 * from any screen to show an approve/reject/cancel/delete confirmation
 * without managing local modal state.
 *
 * Example:
 *   const { confirm } = useConfirm();
 *   const ok = await confirm({
 *     title: "Annuler le transfert ?", titleAr: "إلغاء التحويل؟",
 *     destructive: true,
 *   });
 *   if (ok) cancelTransfer.mutate(...);
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    setLoading(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
    setLoading(false);
  }, []);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {options ? (
        <ConfirmDialog
          visible
          title={t(options.title, options.titleAr ?? options.title)}
          message={
            options.message != null ? t(options.message, options.messageAr ?? options.message) : undefined
          }
          confirmLabel={t(options.confirmLabel ?? "Confirmer", options.confirmLabelAr ?? "تأكيد")}
          cancelLabel={t(options.cancelLabel ?? "Annuler", options.cancelLabelAr ?? "إلغاء")}
          destructive={options.destructive}
          loading={loading}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextType {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
