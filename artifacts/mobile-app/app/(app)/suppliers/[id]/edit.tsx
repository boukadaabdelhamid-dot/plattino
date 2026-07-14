import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSuppliers,
  useUpdateSupplier,
  getGetSuppliersQueryKey,
  type Supplier,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { LoadingView, ErrorState } from "@/components/ui";
import { SupplierForm, emptySupplierForm, supplierToForm, type SupplierFormValues } from "@/components/SupplierForm";

export default function EditSupplier() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, isAdmin, can } = useProtectedRoute({ section: "suppliers" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const supplierId = Number(id);

  const suppliersParams = { limit: 200 };
  const { data: list, isLoading } = useGetSuppliers(suppliersParams, {
    query: { enabled: ready, queryKey: getGetSuppliersQueryKey(suppliersParams) },
  });
  const supplier = ((list as unknown as { data?: Supplier[] })?.data ?? []).find((s) => s.id === supplierId);

  const [values, setValues] = useState<SupplierFormValues>(emptySupplierForm());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (supplier && !hydrated) {
      setValues(supplierToForm(supplier));
      setHydrated(true);
    }
  }, [supplier, hydrated]);

  const updateSupplier = useUpdateSupplier();

  if (!ready) return null;
  const canEdit = isAdmin || can("suppliers", "edit");
  if (!canEdit) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }
  if (isLoading || !hydrated) return <LoadingView />;
  if (!supplier) return <ErrorState title={t("Fournisseur introuvable", "المورد غير موجود")} />;

  function handleSubmit() {
    updateSupplier.mutate(
      {
        id: supplierId,
        data: {
          name: values.name.trim(),
          contactName: values.contactName.trim() || undefined,
          email: values.email.trim() || undefined,
          phone: values.phone.trim() || undefined,
          address: values.address.trim() || undefined,
          notes: values.notes.trim() || undefined,
          contactType: values.contactType,
        },
      },
      {
        onSuccess: () => {
          feedback.success("Fournisseur mis à jour", "تم تحديث المورد");
          queryClient.invalidateQueries({ queryKey: getGetSuppliersQueryKey(suppliersParams) });
          router.replace(`/suppliers/${supplierId}` as never);
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <SupplierForm
        values={values}
        onChange={setValues}
        onSubmit={handleSubmit}
        submitting={updateSupplier.isPending}
        submitLabel={t("Enregistrer", "حفظ")}
      />
    </Screen>
  );
}
