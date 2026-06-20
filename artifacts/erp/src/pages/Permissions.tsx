import { useState, useEffect, useCallback } from "react";
import {
  Shield, Save, Users, ChevronRight, Loader2,
  Eye, PenLine, Plus, Trash2, Lock, Unlock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "@/hooks/use-toast";
import { useLang } from "@/hooks/use-lang";
import { useAuth } from "@/hooks/use-auth";

type PermRow = { section: string; action: string; granted: boolean };

type Employee = {
  userId: number;
  name: string;
  email: string;
  role: string;
  position: string | null;
  status: string | null;
};

const SECTIONS: { key: string; labelFr: string; labelAr: string }[] = [
  { key: "dashboard", labelFr: "Tableau de bord", labelAr: "لوحة التحكم" },
  { key: "orders", labelFr: "Ventes", labelAr: "المبيعات" },
  { key: "caisse", labelFr: "Caisse", labelAr: "الصندوق" },
  { key: "products", labelFr: "Articles", labelAr: "المنتجات" },
  { key: "purchases", labelFr: "Achats", labelAr: "المشتريات" },
  { key: "suppliers", labelFr: "Fournisseurs", labelAr: "الموردون" },
  { key: "inventory", labelFr: "Stock", labelAr: "المخزون" },
  { key: "customers", labelFr: "Clients", labelAr: "العملاء" },
  { key: "employees", labelFr: "Employés", labelAr: "الموظفون" },
  { key: "attendance", labelFr: "Présences", labelAr: "الحضور" },
  { key: "leaves", labelFr: "Congés", labelAr: "الإجازات" },
  { key: "accounting", labelFr: "Comptabilité", labelAr: "المحاسبة" },
  { key: "realtime", labelFr: "Temps Réel", labelAr: "الوقت الفعلي" },
  { key: "settings", labelFr: "Paramètres", labelAr: "الإعدادات" },
];

const ACTIONS: { key: string; labelFr: string; labelAr: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "view", labelFr: "Voir", labelAr: "عرض", icon: Eye },
  { key: "create", labelFr: "Créer", labelAr: "إضافة", icon: Plus },
  { key: "edit", labelFr: "Modifier", labelAr: "تعديل", icon: PenLine },
  { key: "delete", labelFr: "Supprimer", labelAr: "حذف", icon: Trash2 },
];

const TOTAL = SECTIONS.length * ACTIONS.length;

function permKey(section: string, action: string) {
  return `${section}:${action}`;
}

function buildDefaultMap(): Map<string, boolean> {
  const m = new Map<string, boolean>();
  SECTIONS.forEach((s) => ACTIONS.forEach((a) => m.set(permKey(s.key, a.key), false)));
  return m;
}

function rowsToMap(rows: PermRow[]): Map<string, boolean> {
  const m = buildDefaultMap();
  rows.forEach((r) => m.set(permKey(r.section, r.action), r.granted));
  return m;
}

function mapToRows(m: Map<string, boolean>): PermRow[] {
  const rows: PermRow[] = [];
  SECTIONS.forEach((s) =>
    ACTIONS.forEach((a) => {
      rows.push({ section: s.key, action: a.key, granted: m.get(permKey(s.key, a.key)) ?? false });
    }),
  );
  return rows;
}

export default function Permissions() {
  const { lang } = useLang();
  const { token } = useAuth();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empLoading, setEmpLoading] = useState(true);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [permMap, setPermMap] = useState<Map<string, boolean>>(buildDefaultMap());
  const [permLoading, setPermLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const apiBase = ((import.meta.env.VITE_API_URL as string) ?? "").replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  useEffect(() => {
    setEmpLoading(true);
    fetch(`${apiBase}/api/erp/permissions/users`, { headers })
      .then((r) => r.json())
      .then((data: Employee[]) => {
        const users = Array.isArray(data) ? data : [];
        console.log(`[Permissions] Retrieved ${users.length} users from /erp/permissions/users`);
        setEmployees(users);
      })
      .catch((err) => {
        console.error("[Permissions] Failed to fetch users:", err);
      })
      .finally(() => setEmpLoading(false));
  }, [apiBase, token]);

  const loadPerms = useCallback(
    async (emp: Employee) => {
      setPermLoading(true);
      try {
        const res = await fetch(`${apiBase}/api/erp/permissions/${emp.userId}`, { headers });
        const rows: PermRow[] = res.ok ? await res.json() : [];
        setPermMap(rowsToMap(rows));
      } catch {
        setPermMap(buildDefaultMap());
      } finally {
        setPermLoading(false);
      }
    },
    [apiBase, token],
  );

  const selectEmployee = (emp: Employee) => {
    setSelected(emp);
    loadPerms(emp);
  };

  const toggle = (section: string, action: string) => {
    setPermMap((prev) => {
      const next = new Map(prev);
      const k = permKey(section, action);
      next.set(k, !prev.get(k));
      return next;
    });
  };

  const toggleSection = (section: string, value: boolean) => {
    setPermMap((prev) => {
      const next = new Map(prev);
      ACTIONS.forEach((a) => next.set(permKey(section, a.key), value));
      return next;
    });
  };

  const toggleAll = (value: boolean) => {
    setPermMap((prev) => {
      const next = new Map(prev);
      SECTIONS.forEach((s) => ACTIONS.forEach((a) => next.set(permKey(s.key, a.key), value)));
      return next;
    });
  };

  const save = async () => {
    if (!selected?.userId) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/erp/permissions/${selected.userId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(mapToRows(permMap)),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: t("Permissions enregistrées", "تم حفظ الصلاحيات") });
    } catch {
      toast({ title: t("Erreur lors de l'enregistrement", "حدث خطأ"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const grantedCount = Array.from(permMap.values()).filter(Boolean).length;
  const pct = Math.round((grantedCount / TOTAL) * 100);

  const sectionGranted = (key: string) =>
    ACTIONS.filter((a) => permMap.get(permKey(key, a.key))).length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">{t("Gestion des Accès", "إدارة الصلاحيات")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Configurez les permissions par employé", "تحديد صلاحيات كل موظف")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Employee list */}
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-4 py-3 border-b">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4" />
              {t("Employés", "الموظفون")}
            </div>
          </div>
          <div className="divide-y max-h-[calc(100vh-220px)] overflow-y-auto">
            {empLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : employees.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {t("Aucun employé avec compte", "لا يوجد موظفون مرتبطون")}
              </div>
            ) : (
              employees.map((emp) => (
                <button
                  key={emp.userId}
                  type="button"
                  onClick={() => selectEmployee(emp)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between hover:bg-accent/50 transition-colors ${
                    selected?.userId === emp.userId ? "bg-accent" : ""
                  }`}
                >
                  <div>
                    <div className="font-medium text-sm">{emp.name}</div>
                    <div className="text-xs text-muted-foreground">{emp.position}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Permissions panel */}
        <div className="border rounded-lg overflow-hidden">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
              <Shield className="h-10 w-10 opacity-20" />
              <p className="text-sm">{t("Sélectionnez un employé", "اختر موظفاً لتعديل صلاحياته")}</p>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="bg-muted/50 px-4 py-3 border-b flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{selected.name}</div>
                  <div className="text-xs text-muted-foreground">{selected.position}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleAll(false)}
                    className="text-xs h-7 px-2"
                  >
                    <Lock className="h-3 w-3 mr-1" />
                    {t("Tout révoquer", "إلغاء الكل")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleAll(true)}
                    className="text-xs h-7 px-2"
                  >
                    <Unlock className="h-3 w-3 mr-1" />
                    {t("Tout accorder", "منح الكل")}
                  </Button>
                </div>
              </div>

              {/* Progress */}
              <div className="px-4 py-3 border-b space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t("Permissions accordées", "الصلاحيات الممنوحة")}</span>
                  <Badge variant={grantedCount === 0 ? "secondary" : grantedCount === TOTAL ? "default" : "outline"}>
                    {grantedCount} / {TOTAL}
                  </Badge>
                </div>
                <Progress value={pct} className="h-1.5" />
              </div>

              {/* Accordion */}
              {permLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto px-4 py-2">
                  <Accordion type="multiple" className="space-y-1">
                    {SECTIONS.map((sec) => {
                      const granted = sectionGranted(sec.key);
                      const allGranted = granted === ACTIONS.length;
                      const viewGranted = permMap.get(permKey(sec.key, "view")) ?? false;
                      return (
                        <AccordionItem
                          key={sec.key}
                          value={sec.key}
                          className="border rounded-lg px-1 overflow-hidden"
                        >
                          <AccordionTrigger className="px-3 py-3 hover:no-underline hover:bg-accent/30 rounded-md [&[data-state=open]]:rounded-b-none">
                            <div className="flex items-center gap-3 flex-1 text-left">
                              {viewGranted ? (
                                <Unlock className="h-4 w-4 shrink-0 text-primary" />
                              ) : (
                                <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              <span className="text-sm font-medium">
                                {t(sec.labelFr, sec.labelAr)}
                              </span>
                              <Badge
                                variant={granted === 0 ? "secondary" : allGranted ? "default" : "outline"}
                                className="ml-auto mr-2 text-[10px] h-5"
                              >
                                {granted}/{ACTIONS.length}
                              </Badge>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-2 pb-2">
                            <div className="flex justify-end gap-2 py-1 mb-1">
                              <button
                                type="button"
                                onClick={() => toggleSection(sec.key, true)}
                                className="text-[11px] text-primary hover:underline"
                              >
                                {t("Tout activer", "تفعيل الكل")}
                              </button>
                              <span className="text-muted-foreground text-[11px]">·</span>
                              <button
                                type="button"
                                onClick={() => toggleSection(sec.key, false)}
                                className="text-[11px] text-muted-foreground hover:underline"
                              >
                                {t("Tout désactiver", "إلغاء الكل")}
                              </button>
                            </div>
                            <div className="space-y-1">
                              {ACTIONS.map((act) => {
                                const ActionIcon = act.icon;
                                const enabled = permMap.get(permKey(sec.key, act.key)) ?? false;
                                return (
                                  <div
                                    key={act.key}
                                    className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-accent/20 transition-colors"
                                  >
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                      <ActionIcon className="h-3.5 w-3.5 shrink-0" />
                                      <span>{t(act.labelFr, act.labelAr)}</span>
                                    </div>
                                    <Switch
                                      checked={enabled}
                                      onCheckedChange={() => toggle(sec.key, act.key)}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </div>
              )}

              {/* Save */}
              <div className="border-t px-4 py-3 flex justify-end">
                <Button onClick={save} disabled={saving} className="gap-2">
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t("Enregistrer", "حفظ الصلاحيات")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
