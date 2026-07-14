import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEmployees,
  useUpdateEmployee,
  getGetEmployeesQueryKey,
} from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { LoadingView, ErrorState } from "@/components/ui";
import { EmployeeForm, emptyEmployeeForm, employeeToForm, type EmployeeFormValues } from "@/components/EmployeeForm";

export default function EditEmployee() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, isAdmin, can } = useProtectedRoute({ section: "employees" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();
  const employeeId = Number(id);

  const { data: employees, isLoading } = useGetEmployees({
    query: { enabled: ready, queryKey: getGetEmployeesQueryKey() },
  });
  const employee = (employees ?? []).find((e: any) => e.id === employeeId);

  const [values, setValues] = useState<EmployeeFormValues>(emptyEmployeeForm());
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (employee && !hydrated) {
      setValues(employeeToForm(employee));
      setHydrated(true);
    }
  }, [employee, hydrated]);

  const updateEmployee = useUpdateEmployee();

  if (!ready) return null;
  const canEdit = isAdmin || can("employees", "edit");
  if (!canEdit) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }
  if (isLoading || !hydrated) return <LoadingView />;
  if (!employee) return <ErrorState title={t("Employé introuvable", "الموظف غير موجود")} />;

  function handleSubmit() {
    updateEmployee.mutate(
      {
        id: employeeId,
        // The generated update body type (CreateEmployeeRequest) omits `status`,
        // but the backend accepts and applies it — same cast the web ERP uses.
        data: {
          name: values.name.trim(),
          email: values.email.trim() || undefined,
          phone: values.phone.trim() || undefined,
          position: values.position.trim(),
          salary: values.salary,
          hireDate: values.hireDate.toISOString().slice(0, 10),
          status: values.status,
        } as unknown as Parameters<typeof updateEmployee.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          feedback.success("Employé mis à jour", "تم تحديث الموظف");
          queryClient.invalidateQueries({ queryKey: getGetEmployeesQueryKey() });
          router.back();
        },
        onError: (e) => feedback.error(e),
      },
    );
  }

  return (
    <Screen>
      <EmployeeForm
        values={values}
        onChange={setValues}
        onSubmit={handleSubmit}
        submitting={updateEmployee.isPending}
        submitLabel={t("Enregistrer", "حفظ")}
        isEditing
      />
    </Screen>
  );
}
