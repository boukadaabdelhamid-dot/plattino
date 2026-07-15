import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetErpSettingsProductsBrands,
  useGetErpSettingsProductsColors,
  useGetErpSettingsProductsFamilies,
  useGetErpSettingsProductsTypes,
  useCreateErpSettingsProductsBrand,
  useUpdateErpSettingsProductsBrand,
  useDeleteErpSettingsProductsBrand,
  useCreateErpSettingsProductsFamily,
  useUpdateErpSettingsProductsFamily,
  useDeleteErpSettingsProductsFamily,
  useCreateErpSettingsProductsColor,
  useUpdateErpSettingsProductsColor,
  useDeleteErpSettingsProductsColor,
  useCreateErpSettingsProductsType,
  useUpdateErpSettingsProductsType,
  useDeleteErpSettingsProductsType,
  getGetErpSettingsProductsBrandsQueryKey,
  getGetErpSettingsProductsColorsQueryKey,
  getGetErpSettingsProductsFamiliesQueryKey,
  getGetErpSettingsProductsTypesQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { useConfirm } from "@/contexts/confirm-context";
import { Screen } from "@/components/Screen";
import { Card, SectionTitle, Button, FormField } from "@/components/ui";
import { SheetModal } from "@/components/SheetModal";
import { colors } from "@/lib/colors";

type TaxonomyItem = { id: number; nameFr: string; nameAr: string; hexCode?: string | null };

function TaxonomySection({
  title,
  items,
  canWrite,
  withColor,
  onCreate,
  onUpdate,
  onDelete,
  saving,
  deletingId,
}: {
  title: string;
  items: TaxonomyItem[];
  canWrite: boolean;
  withColor?: boolean;
  onCreate: (v: { nameFr: string; nameAr: string; hexCode?: string }) => void;
  onUpdate: (id: number, v: { nameFr: string; nameAr: string; hexCode?: string }) => void;
  onDelete: (id: number) => void;
  saving: boolean;
  deletingId: number | null;
}) {
  const { t, lang } = useLang();
  const { confirm } = useConfirm();
  const [editing, setEditing] = useState<TaxonomyItem | "new" | null>(null);
  const [nameFr, setNameFr] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [hexCode, setHexCode] = useState("");
  const [error, setError] = useState<string | undefined>();

  function openNew() {
    setNameFr("");
    setNameAr("");
    setHexCode("");
    setError(undefined);
    setEditing("new");
  }

  function openEdit(item: TaxonomyItem) {
    setNameFr(item.nameFr);
    setNameAr(item.nameAr);
    setHexCode(item.hexCode ?? "");
    setError(undefined);
    setEditing(item);
  }

  function handleSave() {
    if (!nameFr.trim() || !nameAr.trim()) {
      setError(t("Les deux noms sont requis", "الاسمان مطلوبان"));
      return;
    }
    const payload = { nameFr: nameFr.trim(), nameAr: nameAr.trim(), ...(withColor ? { hexCode: hexCode.trim() || undefined } : {}) };
    if (editing === "new") onCreate(payload);
    else if (editing) onUpdate(editing.id, payload);
    setEditing(null);
  }

  async function handleDelete(item: TaxonomyItem) {
    const ok = await confirm({
      title: "Supprimer cet élément ?",
      titleAr: "حذف هذا العنصر؟",
      destructive: true,
    });
    if (ok) onDelete(item.id);
  }

  return (
    <Card>
      <View style={styles.header}>
        <SectionTitle style={{ marginBottom: 0 }}>{title}</SectionTitle>
        {canWrite ? (
          <Pressable onPress={openNew} hitSlop={8} testID={`button-add-${title}`}>
            <Feather name="plus-circle" size={20} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
      {items.length === 0 ? (
        <Text style={styles.muted}>—</Text>
      ) : (
        items.map((item, i) => (
          <View key={item.id} style={[styles.row, i > 0 && styles.rowBorder]}>
            {withColor && item.hexCode ? <View style={[styles.swatch, { backgroundColor: item.hexCode }]} /> : null}
            <Text style={styles.rowLabel} numberOfLines={1}>
              {lang === "ar" ? item.nameAr : item.nameFr}
            </Text>
            {canWrite ? (
              <View style={styles.rowActions}>
                <Pressable onPress={() => openEdit(item)} hitSlop={8} testID={`button-edit-${item.id}`}>
                  <Feather name="edit-2" size={16} color={colors.textMuted} />
                </Pressable>
                <Pressable onPress={() => handleDelete(item)} hitSlop={8} testID={`button-delete-${item.id}`}>
                  <Feather name="trash-2" size={16} color={colors.danger} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ))
      )}

      <SheetModal
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? t("Ajouter", "إضافة") : t("Modifier", "تعديل")}
      >
        <FormField label={t("Nom (Français)", "الاسم (فرنسي)")} value={nameFr} onChangeText={setNameFr} error={error} />
        <FormField label={t("Nom (Arabe)", "الاسم (عربي)")} value={nameAr} onChangeText={setNameAr} />
        {withColor ? (
          <FormField label={t("Code couleur (hex, optionnel)", "رمز اللون (اختياري)")} value={hexCode} onChangeText={setHexCode} placeholder="#RRGGBB" autoCapitalize="none" />
        ) : null}
        <Button label={t("Enregistrer", "حفظ")} onPress={handleSave} loading={saving} testID="button-save-taxonomy-item" />
      </SheetModal>
    </Card>
  );
}

export default function ProductSettings() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "settings" });
  const { t } = useLang();
  const feedback = useApiFeedback();
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const canCreate = isAdmin || can("settings", "create");
  const canEdit = isAdmin || can("settings", "edit");
  const canDelete = isAdmin || can("settings", "delete");
  const canWrite = canCreate || canEdit || canDelete;

  const brandsQ = useGetErpSettingsProductsBrands({ query: { enabled: ready, queryKey: getGetErpSettingsProductsBrandsQueryKey() } });
  const familiesQ = useGetErpSettingsProductsFamilies({ query: { enabled: ready, queryKey: getGetErpSettingsProductsFamiliesQueryKey() } });
  const colorsQ = useGetErpSettingsProductsColors({ query: { enabled: ready, queryKey: getGetErpSettingsProductsColorsQueryKey() } });
  const typesQ = useGetErpSettingsProductsTypes({ query: { enabled: ready, queryKey: getGetErpSettingsProductsTypesQueryKey() } });

  const createBrand = useCreateErpSettingsProductsBrand();
  const updateBrand = useUpdateErpSettingsProductsBrand();
  const deleteBrand = useDeleteErpSettingsProductsBrand();

  const createFamily = useCreateErpSettingsProductsFamily();
  const updateFamily = useUpdateErpSettingsProductsFamily();
  const deleteFamily = useDeleteErpSettingsProductsFamily();

  const createColor = useCreateErpSettingsProductsColor();
  const updateColor = useUpdateErpSettingsProductsColor();
  const deleteColor = useDeleteErpSettingsProductsColor();

  const createType = useCreateErpSettingsProductsType();
  const updateType = useUpdateErpSettingsProductsType();
  const deleteType = useDeleteErpSettingsProductsType();

  if (!ready) return null;

  return (
    <Screen>
      <TaxonomySection
        title={t("Marques", "الماركات")}
        items={brandsQ.data?.items ?? []}
        canWrite={canWrite}
        saving={createBrand.isPending || updateBrand.isPending}
        deletingId={deletingId}
        onCreate={(data) =>
          createBrand.mutate(
            { data },
            {
              onSuccess: () => {
                feedback.success("Marque ajoutée", "تمت إضافة الماركة");
                queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsBrandsQueryKey() });
              },
              onError: (e) => feedback.error(e),
            },
          )
        }
        onUpdate={(id, data) =>
          updateBrand.mutate(
            { id, data },
            {
              onSuccess: () => {
                feedback.success("Marque mise à jour", "تم تحديث الماركة");
                queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsBrandsQueryKey() });
              },
              onError: (e) => feedback.error(e),
            },
          )
        }
        onDelete={(id) => {
          setDeletingId(id);
          deleteBrand.mutate(
            { id },
            {
              onSuccess: () => {
                feedback.success("Marque supprimée", "تم حذف الماركة");
                queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsBrandsQueryKey() });
                setDeletingId(null);
              },
              onError: (e) => {
                feedback.error(e);
                setDeletingId(null);
              },
            },
          );
        }}
      />

      <TaxonomySection
        title={t("Familles", "الفئات")}
        items={familiesQ.data?.items ?? []}
        canWrite={canWrite}
        saving={createFamily.isPending || updateFamily.isPending}
        deletingId={deletingId}
        onCreate={(data) => createFamily.mutate({ data }, { onSuccess: () => { feedback.success("Famille ajoutée", "تمت إضافة الفئة"); queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsFamiliesQueryKey() }); }, onError: (e) => feedback.error(e) })}
        onUpdate={(id, data) => updateFamily.mutate({ id, data }, { onSuccess: () => { feedback.success("Famille mise à jour", "تم تحديث الفئة"); queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsFamiliesQueryKey() }); }, onError: (e) => feedback.error(e) })}
        onDelete={(id) => deleteFamily.mutate({ id }, { onSuccess: () => { feedback.success("Famille supprimée", "تم حذف الفئة"); queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsFamiliesQueryKey() }); }, onError: (e) => feedback.error(e) })}
      />

      <TaxonomySection
        title={t("Couleurs", "الألوان")}
        items={colorsQ.data?.items ?? []}
        canWrite={canWrite}
        withColor
        saving={createColor.isPending || updateColor.isPending}
        deletingId={deletingId}
        onCreate={(data) => createColor.mutate({ data }, { onSuccess: () => { feedback.success("Couleur ajoutée", "تمت إضافة اللون"); queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsColorsQueryKey() }); }, onError: (e) => feedback.error(e) })}
        onUpdate={(id, data) => updateColor.mutate({ id, data }, { onSuccess: () => { feedback.success("Couleur mise à jour", "تم تحديث اللون"); queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsColorsQueryKey() }); }, onError: (e) => feedback.error(e) })}
        onDelete={(id) => deleteColor.mutate({ id }, { onSuccess: () => { feedback.success("Couleur supprimée", "تم حذف اللون"); queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsColorsQueryKey() }); }, onError: (e) => feedback.error(e) })}
      />

      <TaxonomySection
        title={t("Types de catalogue", "أنواع الكتالوج")}
        items={typesQ.data?.items ?? []}
        canWrite={canWrite}
        saving={createType.isPending || updateType.isPending}
        deletingId={deletingId}
        onCreate={(data) => createType.mutate({ data }, { onSuccess: () => { feedback.success("Type ajouté", "تمت إضافة النوع"); queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsTypesQueryKey() }); }, onError: (e) => feedback.error(e) })}
        onUpdate={(id, data) => updateType.mutate({ id, data }, { onSuccess: () => { feedback.success("Type mis à jour", "تم تحديث النوع"); queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsTypesQueryKey() }); }, onError: (e) => feedback.error(e) })}
        onDelete={(id) => deleteType.mutate({ id }, { onSuccess: () => { feedback.success("Type supprimé", "تم حذف النوع"); queryClient.invalidateQueries({ queryKey: getGetErpSettingsProductsTypesQueryKey() }); }, onError: (e) => feedback.error(e) })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { flex: 1, fontSize: 14, color: colors.text },
  rowActions: { flexDirection: "row", gap: 14 },
  swatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: colors.border },
  muted: { fontSize: 13, color: colors.textMuted },
});
