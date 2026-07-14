import React, { useState } from "react";
import { View, Text } from "react-native";
import { colors } from "@/lib/colors";
import type { Employee, EmployeeStatus } from "@workspace/api-client-react";
import { useLang } from "@/contexts/lang-context";
import { Card, Button, FormField, SectionTitle } from "@/components/ui";
import { DateField } from "@/components/DateField";

export type EmployeeFormValues = {
  name: string;
  email: string;
  phone: string;
  position: string;
  salary: string;
  hireDate: Date;
  password: string;
  status: EmployeeStatus;
};

export function emptyEmployeeForm(): EmployeeFormValues {
  return {
    name: "",
    email: "",
    phone: "",
    position: "",
    salary: "",
    hireDate: new Date(),
    password: "",
    status: "active",
  };
}

export function employeeToForm(e: Employee): EmployeeFormValues {
  return {
    name: e.name ?? "",
    email: e.email ?? "",
    phone: e.phone ?? "",
    position: e.position ?? "",
    salary: String(e.salary ?? ""),
    hireDate: e.hireDate ? new Date(e.hireDate) : new Date(),
    password: "",
    status: e.status ?? "active",
  };
}

const STATUS_OPTIONS: { value: EmployeeStatus; fr: string; ar: string }[] = [
  { value: "active", fr: "Actif", ar: "نشط" },
  { value: "on_leave", fr: "En congé", ar: "في إجازة" },
  { value: "inactive", fr: "Inactif", ar: "غير نشط" },
];

/** Shared create/edit employee form, mirroring the web ERP's employee dialog. */
export function EmployeeForm({
  values,
  onChange,
  onSubmit,
  submitting,
  submitLabel,
  isEditing,
}: {
  values: EmployeeFormValues;
  onChange: (next: EmployeeFormValues) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  isEditing: boolean;
}) {
  const { t, lang } = useLang();
  const currency = lang === "ar" ? "دج" : "DA";
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof EmployeeFormValues>(key: K, v: EmployeeFormValues[K]) {
    onChange({ ...values, [key]: v });
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = t("Requis", "مطلوب");
    if (!values.position.trim()) next.position = t("Requis", "مطلوب");
    if (!values.salary.trim() || Number.isNaN(Number(values.salary))) next.salary = t("Montant invalide", "مبلغ غير صالح");
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
        <SectionTitle>{t("Informations", "المعلومات")}</SectionTitle>
        <FormField label={t("Nom complet", "الاسم الكامل")} value={values.name} onChangeText={(v) => set("name", v)} error={errors.name} />
        <FormField label={t("Poste", "المنصب")} value={values.position} onChangeText={(v) => set("position", v)} error={errors.position} />
        <FormField label="Email" value={values.email} onChangeText={(v) => set("email", v)} keyboardType="email-address" autoCapitalize="none" />
        <FormField label={t("Téléphone", "الهاتف")} value={values.phone} onChangeText={(v) => set("phone", v)} keyboardType="phone-pad" />
        <FormField
          label={t(`Salaire (${currency})`, `الراتب (${currency})`)}
          value={values.salary}
          onChangeText={(v) => set("salary", v)}
          keyboardType="decimal-pad"
          error={errors.salary}
        />
        <DateField label={t("Date d'embauche", "تاريخ التوظيف")} value={values.hireDate} onChange={(d) => set("hireDate", d)} />

        {!isEditing ? (
          <FormField
            label={t("Mot de passe (optionnel)", "كلمة المرور (اختياري)")}
            value={values.password}
            onChangeText={(v) => set("password", v)}
            secureTextEntry
            placeholder={t("Par défaut : midanic2026", "الافتراضي : midanic2026")}
          />
        ) : null}
      </Card>

      {isEditing ? (
        <Card>
          <SectionTitle>{t("Statut", "الحالة")}</SectionTitle>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {STATUS_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                label={t(opt.fr, opt.ar)}
                variant={values.status === opt.value ? "primary" : "secondary"}
                onPress={() => set("status", opt.value)}
                style={{ flexGrow: 1 }}
                testID={`button-status-${opt.value}`}
              />
            ))}
          </View>
          {values.status === "inactive" ? (
            <Text style={{ color: colors.warning, fontSize: 12.5, marginTop: 10 }}>
              {t("⚠ L'employé ne pourra plus se connecter.", "⚠ لن يتمكن الموظف من تسجيل الدخول.")}
            </Text>
          ) : null}
        </Card>
      ) : null}

      <Button label={submitLabel} onPress={handleSubmit} loading={submitting} testID="button-submit-employee" />
    </View>
  );
}
