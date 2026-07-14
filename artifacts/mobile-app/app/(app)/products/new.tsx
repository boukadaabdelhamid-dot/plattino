import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateProduct, getGetProductsQueryKey, type CreateProductRequest } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { ErrorState } from "@/components/ui";
import { ProductForm, emptyProductForm, type ProductFormValues } from "@/components/ProductForm";

export default function NewProduct() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "products" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const [values, setValues] = useState<ProductFormValues>(emptyProductForm());
  const createProduct = useCreateProduct();

  if (!ready) return null;
  const canCreate = isAdmin || can("products", "create");
  if (!canCreate) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }

  function handleSubmit() {
    const payload = {
      nameEn: values.nameEn.trim(),
      nameAr: values.nameAr.trim(),
      price: values.price.trim(),
      stock: Number(values.stock) || 0,
      categoryId: values.categoryId,
      reference: values.reference.trim() || null,
      barcode: values.barcode.trim() || null,
      costPrice: values.costPrice.trim() || null,
      priceGros: values.priceGros.trim() || null,
      brand: values.brand.trim() || null,
      model: values.model.trim() || null,
      color: values.color.trim() || null,
      minStock: values.minStock.trim() ? Number(values.minStock) : null,
      isActive: values.isActive,
      isExposed: values.isExposed,
    } as unknown as CreateProductRequest;

    createProduct.mutate(
      { data: payload },
      {
        onSuccess: (product) => {
          feedback.success("Produit créé", "تم إنشاء المنتج");
          queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() });
          router.replace(`/products/${product.id}` as never);
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <ProductForm
        mode="create"
        values={values}
        onChange={setValues}
        onSubmit={handleSubmit}
        submitting={createProduct.isPending}
        submitLabel={t("Créer le produit", "إنشاء المنتج")}
      />
    </Screen>
  );
}
