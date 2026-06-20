import React, { useState } from "react";
import {
  useGetLeaves, useCreateLeave, useUpdateLeaveStatus, useGetEmployees,
  getGetLeavesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLang } from "@/hooks/use-lang";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Check, X } from "lucide-react";
import { format } from "date-fns";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

export default function Leaves() {
  const qc = useQueryClient();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const { data: leaves, isLoading } = useGetLeaves();
  const { data: employees } = useGetEmployees();
  const createLeave = useCreateLeave();
  const updateStatus = useUpdateLeaveStatus();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    employeeId: "", type: "annual",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    reason: ""
  });

  const empMap: Record<number, string> = {};
  (employees ?? []).forEach((e: any) => { empMap[e.id] = e.name; });

  const handleSave = () => {
    createLeave.mutate(
      { data: { employeeId: parseInt(form.employeeId), type: form.type as any, startDate: form.startDate, endDate: form.endDate, reason: form.reason } },
      { onSettled: () => { qc.invalidateQueries({ queryKey: getGetLeavesQueryKey() }); setOpen(false); } }
    );
  };

  const handleApprove = (id: number) => {
    updateStatus.mutate({ id, data: { status: "approved" } }, {
      onSettled: () => qc.invalidateQueries({ queryKey: getGetLeavesQueryKey() })
    });
  };

  const handleReject = (id: number) => {
    updateStatus.mutate({ id, data: { status: "rejected" } }, {
      onSettled: () => qc.invalidateQueries({ queryKey: getGetLeavesQueryKey() })
    });
  };

  const statusLabels: Record<string, string> = {
    pending: t("En attente", "قيد الانتظار"),
    approved: t("Approuvé", "موافق عليه"),
    rejected: t("Refusé", "مرفوض"),
  };

  const typeLabels: Record<string, string> = {
    annual: t("Annuel", "سنوي"),
    sick: t("Maladie", "مرضي"),
    emergency: t("Urgence", "طارئ"),
    unpaid: t("Sans solde", "بدون أجر"),
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("Congés", "الإجازات")}</h1>
          <p className="text-sm text-muted-foreground">{t("Gérer les demandes de congé", "إدارة طلبات الإجازة")}</p>
        </div>
        <Button onClick={() => setOpen(true)} data-testid="button-add-leave">
          <Plus className="h-4 w-4 mr-2" /> {t("Demander un congé", "طلب إجازة")}
        </Button>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Employé", "الموظف")}</TableHead>
                    <TableHead>{t("Type", "النوع")}</TableHead>
                    <TableHead>{t("Du", "من")}</TableHead>
                    <TableHead>{t("Au", "إلى")}</TableHead>
                    <TableHead>{t("Motif", "السبب")}</TableHead>
                    <TableHead>{t("Statut", "الحالة")}</TableHead>
                    <TableHead>{t("Actions", "الإجراءات")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(leaves ?? []).map((l: any) => (
                    <TableRow key={l.id} data-testid={`row-leave-${l.id}`}>
                      <TableCell className="font-medium">{empMap[l.employeeId] ?? `#${l.employeeId}`}</TableCell>
                      <TableCell className="text-sm">{typeLabels[l.type] ?? l.type}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.startDate ? format(new Date(l.startDate), "dd/MM") : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{l.endDate ? format(new Date(l.endDate), "dd/MM/yyyy") : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{l.reason}</TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[l.status] ?? "bg-gray-100 text-gray-600"}`}>
                          {statusLabels[l.status] ?? l.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        {l.status === "pending" && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-600" onClick={() => handleApprove(l.id)} data-testid={`btn-approve-${l.id}`}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleReject(l.id)} data-testid={`btn-reject-${l.id}`}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!leaves || leaves.length === 0) && (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t("Aucune demande de congé", "لا توجد طلبات إجازة")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("Demande de congé", "طلب إجازة")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs mb-1 block">{t("Employé", "الموظف")}</Label>
              <Select value={form.employeeId} onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("Sélectionner un employé", "اختر موظفاً")} /></SelectTrigger>
                <SelectContent>
                  {(employees ?? []).map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Type", "النوع")}</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["annual", "sick", "emergency", "unpaid"].map((tp) => (
                    <SelectItem key={tp} value={tp}>{typeLabels[tp] ?? tp}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">{t("Date de début", "تاريخ البدء")}</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs mb-1 block">{t("Date de fin", "تاريخ الانتهاء")}</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} className="h-8 text-sm" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{t("Motif", "السبب")}</Label>
              <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="h-8 text-sm" placeholder={t("Motif succinct...", "سبب مختصر...")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Annuler", "إلغاء")}</Button>
            <Button onClick={handleSave} disabled={createLeave.isPending || !form.employeeId} data-testid="button-save-leave">{t("Soumettre", "إرسال")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
