import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPurchaseOrders,
  useGetPurchaseOrderItems,
  useUpdatePurchaseOrder,
  useGetSuppliers,
  useGetProducts,
  getGetPurchaseOrdersQueryKey,
  getGetPurchaseOrderItemsQueryKey,
  getGetSuppliersQueryKey,
  getGetProductsQueryKey,
  type Supplier,
  type Product,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { LoadingView, ErrorState } from "@/components/ui";
import { PurchaseOrderForm, emptyPurchaseOrderForm, type PurchaseOrderFormValues } from "@/components/PurchaseOrderForm";

export default function EditPurchaseOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, isAdmin, can } = useProtectedRoute({ section: "purchases" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const poId = Number(id);

  const poListParams = { limit: 200 };
  const { data: list, isLoading: listLoading } = useGetPurchaseOrders(poListParams, {
    query: { enabled: ready, queryKey: getGetPurchaseOrdersQueryKey(poListParams) },
  });
  const po = ((list as unknown as { data?: { id: number; supplierId: number; notes?: string | null; paymentMethod?: string; status: string }[] })?.data ?? []).find((p) => p.id === poId);

  const { data: items, isLoading: itemsLoading } = useGetPurchaseOrderItems(poId, {
    query: { enabled: ready && !!poId, queryKey: getGetPurchaseOrderItemsQueryKey(poId) },
  });

  const suppliersParams = { limit: 200 };
  const { data: suppliersData, isSuccess: suppliersLoaded } = useGetSuppliers(suppliersParams, {
    query: { enabled: ready, queryKey: getGetSuppliersQueryKey(suppliersParams) },
  });
  const suppliers = ((suppliersData as unknown as { data?: Supplier[] })?.data ?? []) as Supplier[];

  const productsParams = { limit: 500 };
  const { data: productsData, isSuccess: productsLoaded } = useGetProducts(productsParams, {
    query: { enabled: ready, queryKey: getGetProductsQueryKey(productsParams) },
  });
  const products = ((productsData as unknown as { products?: Product[] })?.products ?? []) as Product[];

  const [values, setValues] = useState<PurchaseOrderFormValues>(emptyPurchaseOrderForm());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // Wait for suppliers/products to actually load (not just be non-null) before hydrating,
    // otherwise a PO editing session can silently prefill with a null supplier and empty lines
    // if the header/items happen to resolve before the dependent lookups do.
    if (!hydrated && po && items && suppliersLoaded && productsLoaded) {
      const supplier = suppliers.find((s) => s.id === po.supplierId) ?? null;
      const lines = (items as { productId: number; quantity: number; unitCost: string }[])
        .map((it) => {
          const product = products.find((p) => p.id === it.productId);
          if (!product) return null;
          return { product, quantity: String(it.quantity), unitCost: String(it.unitCost) };
        })
        .filter((l): l is { product: Product; quantity: string; unitCost: string } => l != null);
      setValues({
        supplier,
        notes: po.notes ?? "",
        paymentMethod: po.paymentMethod === "comptant" ? "comptant" : "a_terme",
        lines,
      });
      setHydrated(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [po, items, suppliersLoaded, productsLoaded, hydrated]);

  const updatePO = useUpdatePurchaseOrder();

  if (!ready) return null;
  const canEdit = isAdmin || can("purchases", "edit");
  if (!canEdit) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }
  if (listLoading || itemsLoading || !hydrated) return <LoadingView />;
  if (!po) return <ErrorState title={t("Bon d'achat introuvable", "أمر الشراء غير موجود")} />;
  if (po.status !== "pending") {
    return <ErrorState title={t("Ce bon d'achat n'est plus modifiable", "لم يعد هذا الأمر قابلاً للتعديل")} />;
  }

  function handleSubmit() {
    if (!values.supplier) return;
    updatePO.mutate(
      {
        id: poId,
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
        onSuccess: () => {
          feedback.success("Bon d'achat mis à jour", "تم تحديث أمر الشراء");
          queryClient.invalidateQueries({ queryKey: getGetPurchaseOrdersQueryKey(poListParams) });
          queryClient.invalidateQueries({ queryKey: getGetPurchaseOrderItemsQueryKey(poId) });
          router.replace(`/purchase-orders/${poId}` as never);
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
        submitting={updatePO.isPending}
        submitLabel={t("Enregistrer", "حفظ")}
      />
    </Screen>
  );
}
