/**
 * suggestion-form.tsx — Create or edit a purchase suggestion (Idée).
 * Supports optional image upload via expo-image-picker → POST /api/uploads.
 *
 * Route params (via useLocalSearchParams):
 *   id            – suggestion id when editing
 *   product_name  – prefilled when editing
 *   market_price  – prefilled when editing
 *   notes         – prefilled when editing
 *   image_url     – existing image URL when editing
 */
import React, { useState } from "react";
import {
  ScrollView, StyleSheet, View, Image, Pressable, Text,
  ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { FormField, Button } from "@/components/ui";
import { Screen } from "@/components/Screen";
import { colors } from "@/lib/colors";
import { useCreateSuggestion, usePatchSuggestion } from "@/hooks/use-smart-purchase";
import { getActiveBaseUrl } from "@/lib/api";
import { getToken } from "@/lib/auth-storage";

async function uploadImage(uri: string): Promise<string> {
  const token = getToken();
  const formData = new FormData();
  formData.append("file", { uri, type: "image/jpeg", name: "suggestion.jpg" } as unknown as Blob);
  const res = await fetch(`${getActiveBaseUrl()}/api/uploads`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = (await res.json()) as { url?: string; publicUrl?: string };
  const url = data.publicUrl ?? data.url;
  if (!url) throw new Error("No URL in upload response");
  return url;
}

export default function SuggestionForm() {
  const { ready } = useProtectedRoute({ section: "purchases" });
  const { t } = useLang();
  const router = useRouter();
  const feedback = useApiFeedback();

  const params = useLocalSearchParams<{
    id?: string;
    product_name?: string;
    market_price?: string;
    notes?: string;
    image_url?: string;
  }>();

  const isEdit = !!params.id;

  const [productName, setProductName] = useState(params.product_name ?? "");
  const [marketPrice, setMarketPrice] = useState(params.market_price ?? "");
  const [notes, setNotes]             = useState(params.notes ?? "");
  const [imageUri, setImageUri]       = useState<string | null>(params.image_url ?? null);
  const [uploading, setUploading]     = useState(false);

  const create = useCreateSuggestion();
  const patch  = usePatchSuggestion();

  const submitting = create.isPending || patch.isPending || uploading;

  if (!ready) return null;

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      feedback.error(new Error(t("Permission galerie refusée", "رُفض الوصول إلى المعرض")));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setUploading(true);
    try {
      const url = await uploadImage(uri);
      setImageUri(url);
    } catch (e) {
      feedback.error(e);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    const name = productName.trim();
    if (!name) {
      feedback.error(new Error(t("Le nom du produit est requis", "اسم المنتج مطلوب")));
      return;
    }
    const body = {
      product_name: name,
      market_price: marketPrice.trim() || undefined,
      notes: notes.trim() || undefined,
      image_url: imageUri ?? undefined,
    };

    if (isEdit) {
      patch.mutate(
        { id: Number(params.id), ...body },
        {
          onSuccess: () => {
            feedback.success(t("Idée modifiée", "تم تعديل الاقتراح"), t("Idée modifiée", "تم تعديل الاقتراح"));
            router.back();
          },
          onError: (e) => feedback.error(e),
        },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => {
          feedback.success(t("Idée ajoutée", "تمت إضافة الاقتراح"), t("Idée ajoutée", "تمت إضافة الاقتراح"));
          router.back();
        },
        onError: (e) => feedback.error(e),
      });
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

        {/* Image picker */}
        <Text style={styles.label}>{t("Photo (optionnel)", "صورة (اختياري)")}</Text>
        {imageUri ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
            <Pressable style={styles.removeImg} onPress={() => setImageUri(null)} hitSlop={8}>
              <Feather name="x" size={14} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.pickBtn} onPress={pickImage} disabled={uploading}>
            {uploading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <>
                  <Feather name="camera" size={20} color={colors.primary} />
                  <Text style={styles.pickText}>{t("Choisir une photo", "اختيار صورة")}</Text>
                </>
            }
          </Pressable>
        )}

        <FormField
          label={t("Nom du produit *", "اسم المنتج *")}
          value={productName}
          onChangeText={setProductName}
          placeholder={t("Ex: iPhone 15 Pro Max", "مثال: آيفون 15 برو ماكس")}
        />
        <FormField
          label={t("Prix du marché (DA)", "سعر السوق (دج)")}
          value={marketPrice}
          onChangeText={setMarketPrice}
          placeholder={t("Optionnel", "اختياري")}
          keyboardType="decimal-pad"
        />
        <FormField
          label={t("Remarques", "ملاحظات")}
          value={notes}
          onChangeText={setNotes}
          placeholder={t("Optionnel", "اختياري")}
          multiline
        />
        <View style={{ height: 16 }} />
        <Button
          label={isEdit
            ? t("Enregistrer les modifications", "حفظ التعديلات")
            : t("Ajouter l'idée", "إضافة الاقتراح")}
          onPress={handleSubmit}
          loading={submitting}
          testID="button-submit-suggestion"
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 4 },
  label: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginBottom: 6 },
  pickBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderWidth: 2, borderColor: colors.primary, borderStyle: "dashed",
    borderRadius: 12, paddingVertical: 20, marginBottom: 12,
  },
  pickText: { fontSize: 14, color: colors.primary, fontWeight: "600" },
  previewWrap: { position: "relative", alignSelf: "flex-start", marginBottom: 12 },
  preview: { width: 120, height: 120, borderRadius: 12 },
  removeImg: {
    position: "absolute", top: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center",
  },
});
