import React, { useState, useRef, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useLang } from "@/hooks/use-lang";
import {
  FileSpreadsheet, Upload, CheckCircle2, AlertCircle, AlertTriangle,
  Loader2, SkipForward, RefreshCw, X,
} from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const tok = () => localStorage.getItem("midanic_token") ?? "";

interface PreviewRow {
  index: number;
  nameEn: string;
  barcode: string;
  price: number;
  costPrice: number | null;
  excelCategoryId: number | null;
  resolvedCategoryId: number | null;
  isDuplicate: boolean;
  error: string | null;
}
interface ParseStats {
  total: number;
  new: number;
  duplicates: number;
  errors: number;
  missingCategoryIds: number[];
}
interface ConfirmResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  total: number;
}

type Step = "upload" | "preview" | "result";
type DupeMode = "skip" | "update";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function ImportExcelModal({ open, onClose, onImported }: Props) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => (lang === "ar" ? ar : fr);

  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [stats, setStats] = useState<ParseStats | null>(null);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [dupeMode, setDupeMode] = useState<DupeMode>("skip");

  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ConfirmResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setDragging(false);
    setUploading(false);
    setParseError(null);
    setSessionKey(null);
    setStats(null);
    setPreview([]);
    setDupeMode("skip");
    setConfirming(false);
    setResult(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const parseFile = useCallback(async (file: File) => {
    setUploading(true);
    setParseError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/api/erp/products/import/parse`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok()}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) { setParseError(data.error ?? t("Erreur de traitement", "خطأ في المعالجة")); setUploading(false); return; }
      setSessionKey(data.sessionKey);
      setStats(data.stats);
      setPreview(data.preview ?? []);
      setStep("preview");
    } catch {
      setParseError(t("Erreur réseau", "خطأ في الشبكة"));
    } finally { setUploading(false); }
  }, []);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      setParseError(t("Seuls les fichiers .xlsx / .xls sont acceptés", "فقط ملفات .xlsx / .xls مقبولة"));
      return;
    }
    parseFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleConfirm = async () => {
    if (!sessionKey) return;
    setConfirming(true);
    try {
      const res = await fetch(`${API_BASE}/api/erp/products/import/confirm`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey, mode: dupeMode }),
      });
      const data = await res.json();
      if (!res.ok) { setParseError(data.error ?? t("Erreur d'importation", "خطأ في الاستيراد")); setConfirming(false); return; }
      setResult(data);
      setStep("result");
      onImported();
    } catch {
      setParseError(t("Erreur réseau", "خطأ في الشبكة"));
    } finally { setConfirming(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            {t("Importer des articles depuis Excel", "استيراد المنتجات من Excel")}
          </DialogTitle>
        </DialogHeader>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground border-b pb-3">
          {(["upload", "preview", "result"] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <span className={`flex items-center gap-1 font-medium ${step === s ? "text-[#1B3057]" : step === "result" && s !== "result" ? "text-green-600" : ""}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs
                  ${step === s ? "bg-[#1B3057] text-white" :
                    (s === "upload" && step !== "upload") || (s === "preview" && step === "result") ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                  {i + 1}
                </span>
                {s === "upload" ? t("Fichier", "الملف") : s === "preview" ? t("Aperçu", "معاينة") : t("Résultat", "النتيجة")}
              </span>
              {i < 2 && <span className="text-muted-foreground/40">→</span>}
            </React.Fragment>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── STEP 1: Upload ── */}
          {step === "upload" && (
            <div className="p-4 space-y-4">
              <div
                className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer
                  ${dragging ? "border-[#1B3057] bg-[#1B3057]/5" : "border-muted-foreground/25 hover:border-[#1B3057]/50 hover:bg-muted/30"}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
              >
                {uploading ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-10 w-10 text-[#1B3057] animate-spin" />
                    <p className="text-sm text-muted-foreground">{t("Traitement en cours…", "جارٍ المعالجة…")}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <FileSpreadsheet className="h-12 w-12 text-green-500 opacity-80" />
                    <div>
                      <p className="font-semibold text-[#1B3057]">{t("Glissez votre fichier Excel ici", "اسحب ملف Excel هنا")}</p>
                      <p className="text-sm text-muted-foreground mt-1">{t("ou cliquez pour choisir un fichier .xlsx", "أو انقر لاختيار ملف .xlsx")}</p>
                    </div>
                    <Button variant="outline" size="sm" className="mt-1" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
                      <Upload className="h-4 w-4 mr-2" /> {t("Choisir un fichier", "اختر ملفاً")}
                    </Button>
                  </div>
                )}
                <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
              </div>

              {parseError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {parseError}
                </div>
              )}

              <div className="rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">{t("Format attendu", "الصيغة المتوقعة")}</p>
                <p>{t("Colonnes détectées automatiquement :", "يتم اكتشاف الأعمدة تلقائياً :")}</p>
                <p className="font-mono">ID Catégorie · Désignation · Code · PU Détail · Coût</p>
                <p>{t("La première ligne d'en-tête est détectée automatiquement.", "يتم اكتشاف سطر الرأس تلقائياً.")}</p>
              </div>
            </div>
          )}

          {/* ── STEP 2: Preview ── */}
          {step === "preview" && stats && (
            <div className="p-4 space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label={t("Total lignes", "إجمالي الصفوف")} value={stats.total} color="blue" />
                <StatCard label={t("Nouveaux", "جديد")} value={stats.new} color="green" />
                <StatCard label={t("Doublons", "مكرر")} value={stats.duplicates} color="amber" />
                <StatCard label={t("Erreurs", "أخطاء")} value={stats.errors} color="red" />
              </div>

              {/* Category warning */}
              {stats.missingCategoryIds.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    {t(
                      `ID Catégorie ${stats.missingCategoryIds.join(", ")} introuvable(s) dans la base — les articles seront importés sans catégorie.`,
                      `معرف الفئة ${stats.missingCategoryIds.join(", ")} غير موجود في قاعدة البيانات — ستُستورد المنتجات بدون فئة.`
                    )}
                  </span>
                </div>
              )}

              {/* Duplicate mode */}
              {stats.duplicates > 0 && (
                <div className="border rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium">{t("Que faire avec les doublons ?", "ماذا تفعل بالمكررات؟")}</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setDupeMode("skip")}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${dupeMode === "skip" ? "border-[#1B3057] bg-[#1B3057]/5 text-[#1B3057] font-medium" : "hover:bg-muted/50"}`}
                    >
                      <SkipForward className="h-4 w-4" />
                      {t("Ignorer les doublons", "تجاهل المكررات")}
                    </button>
                    <button
                      onClick={() => setDupeMode("update")}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${dupeMode === "update" ? "border-[#1B3057] bg-[#1B3057]/5 text-[#1B3057] font-medium" : "hover:bg-muted/50"}`}
                    >
                      <RefreshCw className="h-4 w-4" />
                      {t("Mettre à jour les doublons", "تحديث المكررات")}
                    </button>
                  </div>
                </div>
              )}

              {/* Preview table */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  {t(`Aperçu des ${preview.length} premières lignes`, `معاينة أول ${preview.length} صف`)}
                  {stats.total > preview.length && t(` (sur ${stats.total} au total)`, ` (من أصل ${stats.total})`)}
                </p>
                <div className="rounded-lg border overflow-hidden">
                  <div className="overflow-x-auto max-h-64">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead className="w-8">#</TableHead>
                          <TableHead>{t("Désignation", "الاسم")}</TableHead>
                          <TableHead>{t("Code", "الكود")}</TableHead>
                          <TableHead className="text-right">{t("Prix", "السعر")}</TableHead>
                          <TableHead className="text-right">{t("Coût", "التكلفة")}</TableHead>
                          <TableHead>{t("Statut", "الحالة")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.map((row) => (
                          <TableRow key={row.index} className={`text-xs ${row.error ? "bg-red-50/60" : row.isDuplicate ? "bg-amber-50/60" : ""}`}>
                            <TableCell className="text-muted-foreground">{row.index + 1}</TableCell>
                            <TableCell className="max-w-[200px] truncate font-medium">{row.nameEn}</TableCell>
                            <TableCell className="font-mono text-[11px]">{row.barcode}</TableCell>
                            <TableCell className="text-right">{row.price.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{row.costPrice?.toLocaleString() ?? "—"}</TableCell>
                            <TableCell>
                              {row.error ? (
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{row.error}</Badge>
                              ) : row.isDuplicate ? (
                                <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 border-amber-200">{t("Doublon", "مكرر")}</Badge>
                              ) : (
                                <Badge className="text-[10px] px-1.5 py-0 bg-green-100 text-green-700 border-green-200">{t("Nouveau", "جديد")}</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              {parseError && (
                <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 rounded-lg px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {parseError}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: Result ── */}
          {step === "result" && result && (
            <div className="p-6 flex flex-col items-center gap-6 text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">{t("Importation terminée !", "اكتمل الاستيراد!")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t("Voici le résumé de l'opération", "فيما يلي ملخص العملية")}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
                <StatCard label={t("Importés", "تم الاستيراد")} value={result.inserted} color="green" />
                <StatCard label={t("Mis à jour", "تم التحديث")} value={result.updated} color="blue" />
                <StatCard label={t("Ignorés", "تم التجاهل")} value={result.skipped} color="amber" />
                <StatCard label={t("Erreurs", "أخطاء")} value={result.errors} color="red" />
              </div>
              <Button onClick={handleClose} className="bg-[#1B3057] hover:bg-[#1B3057]/90">
                {t("Fermer", "إغلاق")}
              </Button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {step === "preview" && (
          <div className="border-t pt-3 flex items-center justify-between gap-3 px-4 pb-1">
            <Button variant="outline" size="sm" onClick={reset}>
              <X className="h-4 w-4 mr-1.5" /> {t("Recommencer", "إعادة")}
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={confirming || stats?.new === 0 && stats?.duplicates === 0}
              className="bg-[#1B3057] hover:bg-[#1B3057]/90"
            >
              {confirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-2" />}
              {confirming
                ? t("Importation en cours…", "جارٍ الاستيراد…")
                : t(`Importer ${(stats?.new ?? 0) + (dupeMode === "update" ? (stats?.duplicates ?? 0) : 0)} article(s)`,
                    `استيراد ${(stats?.new ?? 0) + (dupeMode === "update" ? (stats?.duplicates ?? 0) : 0)} منتج(ات)`)}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: "green" | "blue" | "amber" | "red" }) {
  const colors = {
    green: "bg-green-50 text-green-700 border-green-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-center ${colors[color]}`}>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-xs mt-0.5 opacity-80">{label}</div>
    </div>
  );
}
