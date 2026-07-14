import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateAttendance,
  useGetEmployees,
  getGetEmployeesQueryKey,
  getGetAttendanceQueryKey,
  CreateAttendanceRequestStatus,
  type Employee,
  type CreateAttendanceRequestStatus as AttendanceStatusType,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { Card, Button, FormField, SectionTitle, ErrorState } from "@/components/ui";
import { PickerField } from "@/components/Picker";
import { DateField } from "@/components/DateField";
import { colors } from "@/lib/colors";

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const STATUS_LABELS: Record<AttendanceStatusType, [string, string]> = {
  present: ["Présent", "حاضر"],
  absent: ["Absent", "غائب"],
  late: ["En retard", "متأخر"],
  half_day: ["Demi-journée", "نصف يوم"],
};

export default function NewAttendance() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isCheckOut = mode === "out";
  const { ready, isAdmin, can } = useProtectedRoute({ section: "attendance" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const { data: employees } = useGetEmployees({ query: { enabled: ready, queryKey: getGetEmployeesQueryKey() } });

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [date, setDate] = useState<Date>(new Date());
  const [status, setStatus] = useState<AttendanceStatusType>(CreateAttendanceRequestStatus.present);
  const [checkIn, setCheckIn] = useState(isCheckOut ? "" : nowHHMM());
  const [checkOut, setCheckOut] = useState(isCheckOut ? nowHHMM() : "");
  const [error, setError] = useState("");

  const createAttendance = useCreateAttendance();

  if (!ready) return null;
  const canCreate = isAdmin || can("attendance", "create");
  if (!canCreate) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }

  function handleSubmit() {
    if (!employee) {
      setError(t("Choisir un employé", "اختر موظفاً"));
      return;
    }
    setError("");
    createAttendance.mutate(
      {
        data: {
          employeeId: employee!.id,
          date: date.toISOString().slice(0, 10),
          status,
          checkIn: checkIn.trim() || undefined,
          checkOut: checkOut.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          feedback.success("Présence enregistrée", "تم تسجيل الحضور");
          queryClient.invalidateQueries({ queryKey: getGetAttendanceQueryKey() });
          router.back();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{isCheckOut ? t("Pointer une sortie", "تسجيل خروج") : t("Pointer une entrée", "تسجيل دخول")}</SectionTitle>
        <PickerField<Employee>
          label={t("Employé", "الموظف")}
          value={employee}
          items={employees ?? []}
          keyExtractor={(e) => String(e.id)}
          labelExtractor={(e) => e.name}
          subtitleExtractor={(e) => e.position}
          onChange={setEmployee}
          placeholder={t("Sélectionner un employé...", "اختر موظفاً...")}
        />
        <DateField label={t("Date", "التاريخ")} value={date} onChange={setDate} />

        <SectionTitle style={{ marginTop: 4 }}>{t("Statut", "الحالة")}</SectionTitle>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {(Object.keys(STATUS_LABELS) as AttendanceStatusType[]).map((s) => {
            const [fr, ar] = STATUS_LABELS[s];
            return (
              <Button
                key={s}
                label={t(fr, ar)}
                variant={status === s ? "primary" : "secondary"}
                onPress={() => setStatus(s)}
                style={{ flexGrow: 1 }}
                testID={`button-status-${s}`}
              />
            );
          })}
        </View>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <FormField label={t("Entrée (HH:MM)", "الدخول (HH:MM)")} value={checkIn} onChangeText={setCheckIn} placeholder="08:00" />
          </View>
          <View style={{ flex: 1 }}>
            <FormField label={t("Sortie (HH:MM)", "الخروج (HH:MM)")} value={checkOut} onChangeText={setCheckOut} placeholder="17:00" />
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={t("Enregistrer", "حفظ")}
          onPress={handleSubmit}
          loading={createAttendance.isPending}
          testID="button-submit-attendance"
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 13, textAlign: "center", marginBottom: 8 },
});
