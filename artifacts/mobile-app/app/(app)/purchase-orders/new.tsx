import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCreatePurchaseOrder, getGetPurchaseOrdersQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { ErrorState } from "@/components/ui";
import { PurchaseOrderForm, emptyPurchaseOrderForm, type PurchaseOrderFormValues } from "@/components/PurchaseOrderForm";

export default function NewPurchaseOrder() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "purchases" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const [values, setValues] = useState<PurchaseOrderFormValues>(emptyPurchaseOrderForm());
  const createPO = useCreatePurchaseOrder();

  if (!ready) return null;
  const canCreate = isAdmin || can("purchases", "create");
  if (!canCreate) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }

  function handleSubmit() {
    if (!values.supplier) return;
    createPO.mutate(
      {
        data: {
          supplierId: values.supplier.id,
          notes: values.notes.trim() || undefined,
          paymentMethod: values.paymentMethod,
          items: values.lines.map((l) => ({
            productId: l.product.id,
            quantity: Number(l.quantity),
            unitCost: Number(l.unitCost),
          })),
        } as any,
      },
      {
        onSuccess: (po) => {
          feedback.success("Bon d'achat créé", "تم إنشاء أمر الشراء");
          queryClient.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey() });
          router.replace(`/purchase-orders/${po.id}` as never);
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <PurchaseOrderForm
        values={values}
        onChange={setValues}
        onSubmit={handleSubmit}
        submitting={createPO.isPending}
        submitLabel={t("Créer le bon d'achat", "إنشاء أمر الشراء")}
      />
    </Screen>
  );
}
