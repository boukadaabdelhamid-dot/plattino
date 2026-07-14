import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateLeave,
  useGetEmployees,
  getGetEmployeesQueryKey,
  getGetLeavesQueryKey,
  CreateLeaveRequestType,
  type Employee,
  type CreateLeaveRequestType as LeaveTypeType,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle, ErrorState } from "@/components/ui";
import { PickerField } from "@/components/Picker";
import { DateRangeField } from "@/components/DateField";
import { colors } from "@/lib/colors";

const TYPE_LABELS: Record<LeaveTypeType, [string, string]> = {
  annual: ["Congé annuel", "إجازة سنوية"],
  sick: ["Congé maladie", "إجازة مرضية"],
  unpaid: ["Congé sans solde", "إجازة بدون راتب"],
  other: ["Autre", "أخرى"],
};

export default function NewLeave() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "leaves" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const { data: employees } = useGetEmployees({ query: { enabled: ready, queryKey: getGetEmployeesQueryKey() } });

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [type, setType] = useState<LeaveTypeType>(CreateLeaveRequestType.annual);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const createLeave = useCreateLeave();

  if (!ready) return null;
  const canCreate = isAdmin || can("leaves", "create");
  if (!canCreate) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!employee) next.employee = t("Choisir un employé", "اختر موظفاً");
    if (!startDate) next.startDate = t("Requis", "مطلوب");
    if (!endDate) next.endDate = t("Requis", "مطلوب");
    if (startDate && endDate && endDate < startDate) next.endDate = t("Doit être après le début", "يجب أن يكون بعد البداية");
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit() {
    if (!validate()) return;
    createLeave.mutate(
      {
        data: {
          employeeId: employee!.id,
          type,
          startDate: startDate!.toISOString().slice(0, 10),
          endDate: endDate!.toISOString().slice(0, 10),
          reason: reason.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          feedback.success("Demande de congé envoyée", "تم إرسال طلب الإجازة");
          queryClient.invalidateQueries({ queryKey: getGetLeavesQueryKey() });
          router.back();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("Demande de congé", "طلب إجازة")}</SectionTitle>
        <PickerField<Employee>
          label={t("Employé", "الموظف")}
          value={employee}
          items={employees ?? []}
          keyExtractor={(e) => String(e.id)}
          labelExtractor={(e) => e.name}
          subtitleExtractor={(e) => e.position}
          onChange={setEmployee}
          placeholder={t("Sélectionner un employé...", "اختر موظفاً...")}
          error={errors.employee}
        />

        <Text style={styles.fieldLabel}>{t("Type de congé", "نوع الإجازة")}</Text>
        <View style={styles.typeRow}>
          {(Object.keys(TYPE_LABELS) as LeaveTypeType[]).map((k) => {
            const [fr, ar] = TYPE_LABELS[k];
            return (
              <Button
                key={k}
                label={t(fr, ar)}
                variant={type === k ? "primary" : "secondary"}
                onPress={() => setType(k)}
                style={{ flexGrow: 1 }}
                testID={`button-leave-type-${k}`}
              />
            );
          })}
        </View>

        <DateRangeField
          label={t("Période", "الفترة")}
          startDate={startDate}
          endDate={endDate}
          onChangeStart={setStartDate}
          onChangeEnd={setEndDate}
          error={errors.startDate || errors.endDate}
        />

        <FormField label={t("Motif (optionnel)", "السبب (اختياري)")} value={reason} onChangeText={setReason} multiline />

        <Button
          label={t("Envoyer la demande", "إرسال الطلب")}
          onPress={handleSubmit}
          loading={createLeave.isPending}
          testID="button-submit-leave"
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: "500" },
  typeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 14 },
});
