import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateEmployee, getGetEmployeesQueryKey } from "@workspace/api-client-react";
import { useProtectedRoute } from "@/hooks/use-protected-route";
import { useLang } from "@/contexts/lang-context";
import { useApiFeedback } from "@/hooks/use-api-feedback";
import { Screen } from "@/components/Screen";
import { ErrorState } from "@/components/ui";
import { EmployeeForm, emptyEmployeeForm, type EmployeeFormValues } from "@/components/EmployeeForm";

export default function NewEmployee() {
  const { ready, isAdmin, can } = useProtectedRoute({ section: "employees" });
  const { t } = useLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedback = useApiFeedback();

  const [values, setValues] = useState<EmployeeFormValues>(emptyEmployeeForm());
  const createEmployee = useCreateEmployee();

  if (!ready) return null;
  const canCreate = isAdmin || can("employees", "create");
  if (!canCreate) {
    return <ErrorState title={t("Action non autorisée", "غير مسموح بهذا الإجراء")} />;
  }

  function handleSubmit() {
    createEmployee.mutate(
      {
        data: {
          name: values.name.trim(),
          email: values.email.trim() || undefined,
          phone: values.phone.trim() || undefined,
          position: values.position.trim(),
          salary: values.salary,
          hireDate: values.hireDate.toISOString().slice(0, 10),
          ...(values.password.trim() ? { password: values.password.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          feedback.success("Employé créé", "تم إنشاء الموظف");
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
        submitting={createEmployee.isPending}
        submitLabel={t("Créer l'employé", "إنشاء الموظف")}
        isEditing={false}
      />
    </Screen>
  );
}
