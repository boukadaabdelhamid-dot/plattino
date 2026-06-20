import React, { useState, useMemo } from "react";
import {
  useGetEmployees, useCreateEmployee, useUpdateEmployee, useDeleteEmployee,
  getGetEmployeesQueryKey,
  type Employee,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

type EmployeeRow = Employee & { solde?: string; role?: string; isActive?: boolean; userId?: number };

type EmpForm = {
  name: string; email: string; phone: string;
  position: string; salary: string; hireDate: string; password: string;
};
const emptyForm: EmpForm = {
  name: "", email: "", phone: "",
  position: "", salary: "", hireDate: new Date().toISOString().slice(0, 10), password: "",
};

type SortCol = "nom" | "prenom" | "email" | "phone" | "solde" | "status";
const PAGE_SIZES = [10, 25, 50];

const statusVariants: Record<string, { bg: string; label: { fr: string; ar: string } }> = {
  active:     { bg: "bg-emerald-100 text-emerald-700", label: { fr: "Actif",    ar: "نشط"       } },
  inactive:   { bg: "bg-gray-100 text-gray-600",       label: { fr: "Inactif",  ar: "غير نشط"   } },
  on_leave:   { bg: "bg-amber-100 text-amber-700",     label: { fr: "En congé", ar: "في إجازة"  } },
  terminated: { bg: "bg-red-100 text-red-700",         label: { fr: "Terminé",  ar: "منهي"      } },
};

function SortIndicator({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-30 shrink-0" />;
  return dir === "asc" ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />;
}

export default function Employees() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";

  const { data: rawEmployees, isLoading } = useGetEmployees();
  const createEmp = useCreateEmployee();
  const updateEmp = useUpdateEmployee();
  const deleteEmp = useDeleteEmployee();

  const [dialog, setDialog] = useState<{ open: boolean; editing: EmployeeRow | null }>({ open: false, editing: null });
  const [form, setForm] = useState<EmpForm>(emptyForm);
  const [editStatus, setEditStatus] = useState<string>("active");

  const [filters, setFilters] = useState({ nom: "", prenom: "", email: "", phone: "", solde: "", status: "" });
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" }>({ col: "nom", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const employees = (rawEmployees ?? []) as EmployeeRow[];

  const withSplit = useMemo(() =>
    employees.map(e => {
      const parts = (e.name ?? "").split(" ");
      return { ...e, nom: parts[0] ?? "", prenom: parts.slice(1).join(" ") || "" };
    }),
  [employees]);

  const setFilter = (k: keyof typeof filters, v: string) => { setFilters(p => ({ ...p, [k]: v })); setPage(1); };
  const toggleSort = (col: SortCol) => setSort(p => ({ col, dir: p.col === col && p.dir === "asc" ? "desc" : "asc" }));

  const filtered = useMemo(() => withSplit.filter(e => {
    if (filters.nom    && !e.nom.toLowerCase().includes(filters.nom.toLowerCase())) return false;
    if (filters.prenom && !e.prenom.toLowerCase().includes(filters.prenom.toLowerCase())) return false;
    if (filters.email  && !(e.email ?? "").toLowerCase().includes(filters.email.toLowerCase())) return false;
    if (filters.phone  && !(e.phone ?? "").toLowerCase().includes(filters.phone.toLowerCase())) return false;
    if (filters.solde  && !String(e.solde ?? "0").includes(filters.solde)) return false;
    if (filters.status && e.status !== filters.status) return false;
    return true;
  }), [withSplit, filters]);

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    let av: string | number, bv: string | number;
    if (sort.col === "solde") { av = Number(a.solde ?? 0); bv = Number(b.solde ?? 0); }
    else {
      const key = sort.col === "nom" ? "nom" : sort.col === "prenom" ? "prenom" : sort.col;
      av = String((a as Record<string, unknown>)[key] ?? "").toLowerCase();
      bv = String((b as Record<string, unknown>)[key] ?? "").toLowerCase();
    }
    if (av < bv) return sort.dir === "asc" ? -1 : 1;
    if (av > bv) return sort.dir === "asc" ? 1 : -1;
    return 0;
  }), [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);
  const startLine = sorted.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const endLine = Math.min(page * pageSize, sorted.length);

  const openCreate = () => { setForm(emptyForm); setEditStatus("active"); setDialog({ open: true, editing: null }); };
  const openEdit = (e: EmployeeRow) => {
    setForm({
      name: e.name ?? "", email: e.email ?? "", phone: e.phone ?? "",
      position: e.position ?? "", salary: String(e.salary ?? ""),
      hireDate: e.hireDate?.slice(0, 10) ?? "", password: "",
    });
    setEditStatus(e.status ?? "active");
    setDialog({ open: true, editing: e });
  };

  const handleSave = () => {
    const onSettled = () => { qc.invalidateQueries({ queryKey: getGetEmployeesQueryKey() }); setDialog({ open: false, editing: null }); };
    if (dialog.editing) {
      updateEmp.mutate({
        id: dialog.editing.id,
        data: {
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          position: form.position,
          salary: form.salary,
          hireDate: form.hireDate,
          status: editStatus as Employee["status"],
        } as unknown as Parameters<typeof updateEmp.mutate>[0]["data"],
      }, { onSettled });
    } else {
      createEmp.mutate({
        data: {
          name: form.name,
          email: form.email || undefined,
          phone: form.phone || undefined,
          position: form.position,
          salary: form.salary,
          hireDate: form.hireDate,
          ...(form.password ? { password: form.password } : {}),
        } as unknown as Parameters<typeof createEmp.mutate>[0]["data"],
      }, { onSettled });
    }
  };

  const cols: { key: SortCol; fr: string; ar: string }[] = [
    { key: "nom",    fr: "Nom",    ar: "اللقب"  },
    { key: "prenom", fr: "Prénom", ar: "الاسم"  },
    { key: "email",  fr: "Email",  ar: "البريد" },
    { key: "phone",  fr: "Tél.",   ar: "الهاتف" },
    { key: "solde",  fr: "Solde",  ar: "الرصيد" },
    { key: "status", fr: "État",   ar: "الحالة" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("Employés", "الموظفون")}</h1>
          <p className="text-sm text-muted-foreground">{t("Gérer votre équipe", "إدارة الفريق")}</p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-employee">
          <Plus className="h-4 w-4 mr-2" /> {t("Ajouter", "إضافة")}
        </Button>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    {cols.map(c => (
                      <th key={c.key} onClick={() => toggleSort(c.key)}
                        className="py-2.5 px-3 text-left cursor-pointer select-none hover:bg-muted/60 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          <span>{t(c.fr, c.ar)}</span>
                          <SortIndicator active={sort.col === c.key} dir={sort.dir} />
                        </div>
                      </th>
                    ))}
                    <th className="py-2.5 px-3 w-20 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {t("Actions", "إجراءات")}
                    </th>
                  </tr>
                  <tr className="border-b bg-slate-50/60">
                    {cols.map(c => (
                      <td key={c.key} className="py-1 px-3">
                        {c.key === "status" ? (
                          <select value={filters.status} onChange={e => setFilter("status", e.target.value)}
                            className="w-full h-6 text-xs bg-transparent border-b border-dashed focus:outline-none focus:border-primary text-muted-foreground">
                            <option value="">{t("Tous", "الكل")}</option>
                            {Object.entries(statusVariants).map(([k, v]) => (
                              <option key={k} value={k}>{t(v.label.fr, v.label.ar)}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={filters[c.key === "nom" ? "nom" : c.key === "prenom" ? "prenom" : c.key as keyof typeof filters] ?? ""}
                            onChange={e => setFilter(c.key === "nom" ? "nom" : c.key === "prenom" ? "prenom" : c.key as keyof typeof filters, e.target.value)}
                            placeholder={t("Filtre...", "بحث...")}
                            className="w-full h-6 border-b border-dashed px-0 text-xs bg-transparent focus:outline-none focus:border-primary placeholder:text-muted-foreground/40"
                          />
                        )}
                      </td>
                    ))}
                    <td />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={7} className="py-12 text-center text-muted-foreground italic text-sm">
                      {t("Aucun employé", "لا يوجد موظفون")}
                    </td></tr>
                  ) : pageRows.map(e => (
                    <tr key={e.id} data-testid={`row-employee-${e.id}`}
                      className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="py-2.5 px-3 font-semibold">
                        <div className="flex items-center gap-1.5">
                          {e.nom || "—"}
                          {e.role === "admin" && (
                            <span className="text-[10px] px-1.5 py-0 rounded bg-blue-100 text-blue-700 font-semibold leading-5">Admin</span>
                          )}
                          {e.isActive === false && (
                            <span className="text-[10px] px-1.5 py-0 rounded bg-red-100 text-red-600 font-semibold leading-5">{t("Bloqué", "محظور")}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">{e.prenom || "—"}</td>
                      <td className="py-2.5 px-3 text-muted-foreground text-xs truncate max-w-[160px]">{e.email ?? "—"}</td>
                      <td className="py-2.5 px-3 text-muted-foreground text-sm whitespace-nowrap">{e.phone ?? "—"}</td>
                      <td className="py-2.5 px-3 tabular-nums font-semibold text-right whitespace-nowrap">
                        {Number(e.solde ?? 0).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${statusVariants[e.status]?.bg ?? "bg-gray-100 text-gray-600"}`}>
                          {t(statusVariants[e.status]?.label.fr ?? e.status, statusVariants[e.status]?.label.ar ?? e.status)}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(e)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => { if (confirm(t("Désactiver cet employé ?", "تعطيل هذا الموظف؟"))) deleteEmp.mutate({ id: e.id }, { onSettled: () => qc.invalidateQueries({ queryKey: getGetEmployeesQueryKey() }) }); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {sorted.length > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>{t("Lignes par page", "سطور بالصفحة")}</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="h-7 border rounded px-2 text-xs bg-background">
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span>{t(`Lignes ${startLine} à ${endLine} (${sorted.length} éléments)`, `سطر ${startLine} إلى ${endLine} (${sorted.length} عنصر)`)}</span>
            <button className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted/40 disabled:opacity-30 text-base"
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>‹</button>
            <span className="font-medium">{page}</span>
            <button className="h-7 w-7 flex items-center justify-center border rounded hover:bg-muted/40 disabled:opacity-30 text-base"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>›</button>
          </div>
        </div>
      )}

      <Dialog open={dialog.open} onOpenChange={v => setDialog(d => ({ ...d, open: v }))}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialog.editing ? t("Modifier l'employé", "تعديل الموظف") : t("Ajouter un employé", "إضافة موظف")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            {([
              { label: t("Nom complet", "الاسم الكامل"), key: "name"     as keyof EmpForm, type: "text"     },
              { label: t("Poste", "المنصب"),             key: "position" as keyof EmpForm, type: "text"     },
              { label: "Email",                          key: "email"    as keyof EmpForm, type: "email"    },
              { label: t("Téléphone", "الهاتف"),        key: "phone"    as keyof EmpForm, type: "text"     },
              { label: t(`Salaire (${currency})`, `الراتب (${currency})`), key: "salary" as keyof EmpForm, type: "number" },
              { label: t("Date d'embauche", "تاريخ التوظيف"), key: "hireDate" as keyof EmpForm, type: "date" },
            ] as const).map(({ label, key, type }) => (
              <div key={key}>
                <Label className="text-xs mb-1 block">{label}</Label>
                <Input value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  type={type} className="h-8 text-sm" />
              </div>
            ))}

            {!dialog.editing && (
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">{t("Mot de passe (optionnel)", "كلمة المرور (اختياري)")}</Label>
                <Input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  type="password" className="h-8 text-sm"
                  placeholder={t("Par défaut : midanic2026", "الافتراضي : midanic2026")} />
              </div>
            )}

            {dialog.editing && (
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">{t("Statut", "الحالة")}</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusVariants).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{t(v.label.fr, v.label.ar)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(editStatus === "inactive" || editStatus === "terminated") && (
                  <p className="text-xs text-amber-600 mt-1">
                    {t("⚠ L'employé ne pourra plus se connecter.", "⚠ لن يتمكن الموظف من تسجيل الدخول.")}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, editing: null })}>{t("Annuler", "إلغاء")}</Button>
            <Button onClick={handleSave} disabled={createEmp.isPending || updateEmp.isPending} data-testid="button-save-employee">
              {t("Enregistrer", "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
