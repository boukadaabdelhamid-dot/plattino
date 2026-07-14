import React, { useState } from "react";
import { View } from "react-native";
import type { Supplier } from "@workspace/api-client-react";
import { useLang } from "@/contexts/lang-context";
import { Card, Button, FormField, SectionTitle } from "@/components/ui";

export type SupplierFormValues = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  contactType: "supplier" | "customer_supplier";
};

export function emptySupplierForm(): SupplierFormValues {
  return { name: "", contactName: "", email: "", phone: "", address: "", notes: "", contactType: "supplier" };
}

export function supplierToForm(s: Supplier): SupplierFormValues {
  return {
    name: s.name ?? "",
    contactName: s.contactName ?? "",
    email: s.email ?? "",
    phone: s.phone ?? "",
    address: s.address ?? "",
    notes: s.notes ?? "",
    contactType: s.contactType === "customer_supplier" ? "customer_supplier" : "supplier",
  };
}

/** Shared create/edit supplier form, mirroring the web ERP's supplier dialog. */
export function SupplierForm({
  values,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
}: {
  values: SupplierFormValues;
  onChange: (next: SupplierFormValues) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const { t } = useLang();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof SupplierFormValues>(key: K, v: SupplierFormValues[K]) {
    onChange({ ...values, [key]: v });
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = t("Requis", "مطلوب");
    if (values.contactType === "customer_supplier" && !values.email.trim()) {
      next.email = t("Email requis pour un client/fournisseur", "البريد الإلكتروني مطلوب");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    onSubmit();
  }

  return (
    <View>
      <Card>
        <SectionTitle>{t("Type de contact", "نوع الاتصال")}</SectionTitle>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button
            label={t("Fournisseur", "مورد")}
            variant={values.contactType === "supplier" ? "primary" : "secondary"}
            onPress={() => set("contactType", "supplier")}
            style={{ flex: 1 }}
          />
          <Button
            label={t("Client + fournisseur", "عميل + مورد")}
            variant={values.contactType === "customer_supplier" ? "primary" : "secondary"}
            onPress={() => set("contactType", "customer_supplier")}
            style={{ flex: 1 }}
          />
        </View>
      </Card>

      <Card>
        <SectionTitle>{t("Coordonnées", "معلومات الاتصال")}</SectionTitle>
        <FormField label={t("Nom", "الاسم")} value={values.name} onChangeText={(v) => set("name", v)} error={errors.name} />
        <FormField label={t("Personne à contacter", "شخص الاتصال")} value={values.contactName} onChangeText={(v) => set("contactName", v)} />
        <FormField label={t("Email", "البريد الإلكتروني")} value={values.email} onChangeText={(v) => set("email", v)} keyboardType="email-address" autoCapitalize="none" error={errors.email} />
        <FormField label={t("Téléphone", "الهاتف")} value={values.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" />
        <FormField label={t("Adresse", "العنوان")} value={values.address} onChangeText={(v) => set("address", v)} />
        <FormField label={t("Notes", "ملاحظات")} value={values.notes} onChangeText={(v) => set("notes", v)} multiline />
      </Card>

      <Button label={submitLabel} onPress={handleSubmit} loading={submitting} testID="button-submit-supplier" />
    </View>
  );
}
