import React, { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { format } from "date-fns";

function escHtml(str: string | null | undefined): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function toBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { mode: "cors" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

type LabelSize = "A6" | "A5" | "thermal";

interface SizeCfg {
  label: string;
  labelAr: string;
  widthMm: number;
  heightMm: number;
  /* recipient (customer) font sizes */
  namePx: number;
  phonePx: number;
  infoPx: number;
  /* sender (store) font sizes ~55% of recipient */
  storeNamePx: number;
  storePhonePx: number;
  storeInfoPx: number;
}

const SIZES: Record<LabelSize, SizeCfg> = {
  A6:      { label: "A6 (105×148 mm)",  labelAr: "A6 (105×148 ملم)",  widthMm: 105, heightMm: 148, namePx: 30, phonePx: 24, infoPx: 14, storeNamePx: 17, storePhonePx: 14, storeInfoPx: 11 },
  A5:      { label: "A5 (148×210 mm)",  labelAr: "A5 (148×210 ملم)",  widthMm: 148, heightMm: 210, namePx: 42, phonePx: 34, infoPx: 18, storeNamePx: 23, storePhonePx: 19, storeInfoPx: 14 },
  thermal: { label: "100×150 mm حراري", labelAr: "100×150 ملم حراري", widthMm: 100, heightMm: 150, namePx: 27, phonePx: 22, infoPx: 13, storeNamePx: 15, storePhonePx: 13, storeInfoPx: 10 },
};

export interface LabelCustomer {
  customerId: number;
  name: string;
  phone?: string | null;
  wilaya?: string | null;
  commune?: string | null;
  address?: string | null;
  orderDate?: Date | null;
}

export interface StoreInfo {
  name: string;
  phone?: string | null;
  address?: string | null;
  logoUrl?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  customer: LabelCustomer;
  storeInfo: StoreInfo | null;
  lang: string;
}

/* ─── HTML string for print window ─────────────────────────────────────────── */
function buildLabelHtml(
  customer: LabelCustomer,
  store: StoreInfo | null,
  cfg: SizeCfg,
  isAr: boolean,
  logoBase64: string | null,
): string {
  const today = format(customer.orderDate ?? new Date(), "dd/MM/yyyy");
  const dir = isAr ? "rtl" : "ltr";

  /* safe customer values */
  const idStr       = escHtml(`#${String(customer.customerId).padStart(5, "0")}`);
  const safeName    = escHtml(customer.name);
  const safePhone   = escHtml(customer.phone);
  const safeWilaya  = escHtml(customer.wilaya);
  const safeCommune = escHtml(customer.commune);
  const safeAddress = escHtml(customer.address);
  const locationParts = [safeCommune, safeWilaya].filter(Boolean).join(" — ");

  /* safe store values */
  const safeStoreName    = store ? escHtml(store.name) : "";
  const safeStorePhone   = store ? escHtml(store.phone) : "";
  const safeStoreAddress = store ? escHtml(store.address) : "";
  const hasStore = !!store && (safeStoreName || safeStorePhone || safeStoreAddress);

  const senderLabel    = isAr ? "المرسِل" : "Expéditeur";
  const recipientLabel = isAr ? "المستلِم" : "Destinataire";

  /* Only embed logo when we have a safe base64 data URL — never fall back to
     a remote URL in the print window (cross-origin / popup sandbox issues). */
  const logoHtml = logoBase64
    ? `<img src="${escHtml(logoBase64)}" alt="logo" style="height:${cfg.storeNamePx * 1.4}px;max-width:${cfg.widthMm * 0.2}mm;object-fit:contain;display:block;"/>`
    : "";

  return `
<div style="
  width:${cfg.widthMm}mm; height:${cfg.heightMm}mm;
  box-sizing:border-box; padding:4mm 5mm;
  border:0.6mm solid #000;
  display:flex; flex-direction:column;
  font-family:'Cairo','Tajawal',Arial,sans-serif;
  background:#fff; color:#000;
  direction:${dir}; overflow:hidden;
">

  <!-- ① Top bar: ID + date -->
  <div style="display:flex; justify-content:space-between; align-items:center;
    border-bottom:0.3mm solid #aaa; padding-bottom:1.5mm; margin-bottom:2.5mm; flex-shrink:0;">
    <span style="font-size:${cfg.storeInfoPx}px; font-weight:800;">${idStr}</span>
    <span style="font-size:${cfg.storeInfoPx * 0.85}px; color:#666;">${escHtml(today)}</span>
  </div>

  ${hasStore ? `
  <!-- ② Sender section (store) -->
  <div style="flex-shrink:0; margin-bottom:2mm; padding-bottom:2mm;
    border-bottom:0.4mm dashed #777; background:#f9f9f9;
    border-radius:1mm; padding:2mm 3mm; margin-bottom:2.5mm;">
    <div style="font-size:${cfg.storeInfoPx * 0.85}px; font-weight:700; color:#555; letter-spacing:0.5px;
      text-transform:uppercase; margin-bottom:1.5mm;">
      ${escHtml(senderLabel)}
    </div>
    <div style="display:flex; align-items:center; gap:2mm; margin-bottom:${logoHtml ? "0mm" : "0"};">
      ${logoHtml}
      <div style="font-size:${cfg.storeNamePx}px; font-weight:900; line-height:1.2;">${safeStoreName}</div>
    </div>
    ${safeStorePhone ? `
    <div style="font-size:${cfg.storePhonePx}px; font-weight:600; direction:ltr; margin-top:1mm;">
      &#128222; ${safeStorePhone}
    </div>` : ""}
    ${safeStoreAddress ? `
    <div style="font-size:${cfg.storeInfoPx}px; color:#444; margin-top:1mm; line-height:1.3;">
      ${safeStoreAddress}
    </div>` : ""}
  </div>` : ""}

  <!-- ③ Recipient section (customer) -->
  <div style="flex:1; display:flex; flex-direction:column; overflow:hidden; min-height:0;">
    <div style="font-size:${cfg.storeInfoPx * 0.85}px; font-weight:700; color:#555; letter-spacing:0.5px;
      text-transform:uppercase; margin-bottom:1.5mm; flex-shrink:0;">
      ${escHtml(recipientLabel)}
    </div>
    <!-- Name -->
    <div style="font-size:${cfg.namePx}px; font-weight:900; line-height:1.15; word-break:break-word; flex-shrink:0; margin-bottom:2mm;">
      ${safeName}
    </div>
    ${safePhone ? `
    <!-- Phone -->
    <div style="flex-shrink:0; margin-bottom:2mm; padding:1.5mm 2.5mm;
      background:#f0f0f0; border-radius:1.5mm;">
      <div style="font-size:${cfg.phonePx}px; font-weight:800; direction:ltr; letter-spacing:0.5px;">
        &#128222; ${safePhone}
      </div>
    </div>` : ""}
    <!-- Location + address -->
    <div style="flex:1; display:flex; flex-direction:column; gap:1.5mm; overflow:hidden;">
      ${locationParts ? `
      <div style="font-size:${cfg.infoPx + 1}px; font-weight:700; flex-shrink:0;">
        &#128205; ${locationParts}
      </div>` : ""}
      ${safeAddress ? `
      <div style="font-size:${cfg.infoPx}px; line-height:1.4; color:#222; word-break:break-word;">
        ${safeAddress}
      </div>` : ""}
    </div>
  </div>

  <!-- ④ Footer -->
  <div style="border-top:0.4mm solid #000; padding-top:1.5mm; margin-top:2mm; flex-shrink:0;
    display:flex; justify-content:center;">
    <span style="font-size:${cfg.storeInfoPx * 0.75}px; font-weight:700; letter-spacing:2px; color:#333;">
      MIDANIC
    </span>
  </div>
</div>`;
}

/* ─── React preview (mirrors buildLabelHtml but uses JSX) ───────────────────── */
function LabelPreview({
  customer, store, cfg, lang,
}: {
  customer: LabelCustomer;
  store: StoreInfo | null;
  cfg: SizeCfg;
  lang: string;
}) {
  const isAr = lang === "ar";
  const dir = isAr ? "rtl" : "ltr";
  const today = format(customer.orderDate ?? new Date(), "dd/MM/yyyy");
  const idStr = `#${String(customer.customerId).padStart(5, "0")}`;
  const locationParts = [customer.commune, customer.wilaya].filter(Boolean).join(" — ");
  const senderLabel    = isAr ? "المرسِل" : "Expéditeur";
  const recipientLabel = isAr ? "المستلِم" : "Destinataire";
  const hasStore = !!store && (store.name || store.phone || store.address);

  const font = { fontFamily: "'Cairo','Tajawal',Arial,sans-serif" as const };
  const sectionLabelStyle: React.CSSProperties = {
    fontSize: cfg.storeInfoPx * 0.85,
    fontWeight: 700,
    color: "#555",
    letterSpacing: "0.5px",
    textTransform: "uppercase",
    marginBottom: "1.5mm",
    flexShrink: 0,
  };

  return (
    <div style={{
      width: `${cfg.widthMm}mm`, height: `${cfg.heightMm}mm`,
      boxSizing: "border-box", padding: "4mm 5mm",
      border: "0.6mm solid #000",
      display: "flex", flexDirection: "column",
      background: "#fff", color: "#000", direction: dir, overflow: "hidden",
      ...font,
    }}>
      {/* ① Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "0.3mm solid #aaa", paddingBottom: "1.5mm", marginBottom: "2.5mm", flexShrink: 0 }}>
        <span style={{ fontSize: cfg.storeInfoPx, fontWeight: 800 }}>{idStr}</span>
        <span style={{ fontSize: cfg.storeInfoPx * 0.85, color: "#666" }}>{today}</span>
      </div>

      {/* ② Sender (store) */}
      {hasStore && (
        <div style={{ flexShrink: 0, borderBottom: "0.4mm dashed #777", background: "#f9f9f9", borderRadius: "1mm", padding: "2mm 3mm", marginBottom: "2.5mm" }}>
          <div style={sectionLabelStyle}>{senderLabel}</div>
          <div style={{ display: "flex", alignItems: "center", gap: "2mm" }}>
            {store!.logoUrl && (
              <img
                src={store!.logoUrl}
                alt="logo"
                style={{ height: cfg.storeNamePx * 1.4, maxWidth: `${cfg.widthMm * 0.2}mm`, objectFit: "contain", display: "block" }}
              />
            )}
            <div style={{ fontSize: cfg.storeNamePx, fontWeight: 900, lineHeight: 1.2 }}>{store!.name}</div>
          </div>
          {store!.phone && (
            <div style={{ fontSize: cfg.storePhonePx, fontWeight: 600, direction: "ltr", marginTop: "1mm" }}>
              📞 {store!.phone}
            </div>
          )}
          {store!.address && (
            <div style={{ fontSize: cfg.storeInfoPx, color: "#444", marginTop: "1mm", lineHeight: 1.3 }}>
              {store!.address}
            </div>
          )}
        </div>
      )}

      {/* ③ Recipient (customer) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <div style={sectionLabelStyle}>{recipientLabel}</div>
        <div style={{ fontSize: cfg.namePx, fontWeight: 900, lineHeight: 1.15, wordBreak: "break-word", flexShrink: 0, marginBottom: "2mm" }}>
          {customer.name}
        </div>
        {customer.phone && (
          <div style={{ flexShrink: 0, marginBottom: "2mm", padding: "1.5mm 2.5mm", background: "#f0f0f0", borderRadius: "1.5mm" }}>
            <div style={{ fontSize: cfg.phonePx, fontWeight: 800, direction: "ltr", letterSpacing: "0.5px" }}>
              📞 {customer.phone}
            </div>
          </div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.5mm", overflow: "hidden" }}>
          {locationParts && (
            <div style={{ fontSize: cfg.infoPx + 1, fontWeight: 700, flexShrink: 0 }}>📍 {locationParts}</div>
          )}
          {customer.address && (
            <div style={{ fontSize: cfg.infoPx, lineHeight: 1.4, color: "#222", wordBreak: "break-word" }}>
              {customer.address}
            </div>
          )}
        </div>
      </div>

      {/* ④ Footer */}
      <div style={{ borderTop: "0.4mm solid #000", paddingTop: "1.5mm", marginTop: "2mm", flexShrink: 0, display: "flex", justifyContent: "center" }}>
        <span style={{ fontSize: cfg.storeInfoPx * 0.75, fontWeight: 700, letterSpacing: 2, color: "#333" }}>MIDANIC</span>
      </div>
    </div>
  );
}

/* ─── Modal ─────────────────────────────────────────────────────────────────── */
export function ShippingLabelModal({ open, onClose, customer, storeInfo, lang }: Props) {
  const [size, setSize] = useState<LabelSize>("A6");
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const isAr = lang === "ar";
  const cfg = SIZES[size];

  const handlePrint = async () => {
    /* Open the print window synchronously within the user-gesture call stack so
       browsers do not block the popup. We populate it after the async logo fetch. */
    const win = window.open("", "_blank", "width=700,height=500");
    if (!win) return;

    setPrinting(true);
    /* Show a loading placeholder while we fetch the logo */
    win.document.write("<!DOCTYPE html><html><body style='font-family:sans-serif;padding:2em'>Préparation…</body></html>");
    win.document.close();

    let logoBase64: string | null = null;
    if (storeInfo?.logoUrl) {
      logoBase64 = await toBase64(storeInfo.logoUrl);
      /* If conversion failed, logoBase64 stays null — no remote URL fallback */
    }
    setPrinting(false);

    const safeCopies = Math.max(1, Math.min(20, Math.floor(copies)));
    const labelHtml = buildLabelHtml(customer, storeInfo, cfg, isAr, logoBase64);
    const separator = `<div style="page-break-after:always;height:0;overflow:hidden;"></div>`;
    const allLabels = Array(safeCopies).fill(labelHtml).join(separator);

    /* Replace the placeholder with the final label content */
    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html><head>
  <meta charset="utf-8"/>
  <title>${escHtml(isAr ? "ملصق الشحن" : "Étiquette de livraison")} — ${escHtml(customer.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #fff; }
    @page { size: ${cfg.widthMm}mm ${cfg.heightMm}mm; margin: 0; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head><body>${allLabels}</body></html>`);
    win.document.close();
    win.addEventListener("load", () => { win.focus(); win.print(); });
  };

  const previewScale = size === "A5" ? 0.47 : size === "A6" ? 0.6 : 0.62;
  const changeCopies = (delta: number) => setCopies((c) => Math.max(1, Math.min(20, c + delta)));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl" dir={isAr ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Printer className="h-4 w-4" />
            {isAr ? "طباعة ملصق الشحن" : "Étiquette de livraison"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[220px_1fr] gap-5">
          {/* ── Left: settings ── */}
          <div className="space-y-5">
            {/* Size selector */}
            <div>
              <Label className="text-xs font-semibold mb-2 block uppercase tracking-wide text-muted-foreground">
                {isAr ? "حجم الملصق" : "Format"}
              </Label>
              <div className="space-y-1.5">
                {(Object.entries(SIZES) as [LabelSize, SizeCfg][]).map(([key, s]) => (
                  <label
                    key={key}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors ${
                      size === key
                        ? "border-[#1B3057] bg-[#1B3057]/5 font-semibold text-[#1B3057]"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio" name="label-size" value={key}
                      checked={size === key} onChange={() => setSize(key)}
                      className="accent-[#1B3057]"
                    />
                    {isAr ? s.labelAr : s.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Copies */}
            <div>
              <Label className="text-xs font-semibold mb-2 block uppercase tracking-wide text-muted-foreground">
                {isAr ? "عدد النسخ" : "Copies"}
              </Label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0 text-base font-bold"
                  onClick={() => changeCopies(-1)}>−</Button>
                <Input
                  type="number" min={1} max={20}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(20, Math.floor(Number(e.target.value) || 1))))}
                  className="h-8 w-14 text-center text-sm"
                />
                <Button variant="outline" size="sm" className="h-8 w-8 p-0 text-base font-bold"
                  onClick={() => changeCopies(1)}>+</Button>
              </div>
            </div>

            {/* Store mini-summary */}
            {storeInfo && (storeInfo.name || storeInfo.phone || storeInfo.address) && (
              <div className="rounded-lg border bg-muted/20 p-3 text-xs space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  {isAr ? "المرسِل" : "Expéditeur"}
                </p>
                {storeInfo.logoUrl && (
                  <img src={storeInfo.logoUrl} alt="logo" className="h-6 object-contain mb-1" />
                )}
                {storeInfo.name && <p className="font-bold text-foreground">{storeInfo.name}</p>}
                {storeInfo.phone && <p className="text-muted-foreground">📞 {storeInfo.phone}</p>}
                {storeInfo.address && <p className="text-muted-foreground truncate">{storeInfo.address}</p>}
              </div>
            )}

            {/* Customer mini-summary */}
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                {isAr ? "المستلِم" : "Destinataire"}
              </p>
              <p className="font-bold text-sm text-foreground">{customer.name}</p>
              {customer.phone && <p className="text-muted-foreground">📞 {customer.phone}</p>}
              {(customer.wilaya || customer.commune) && (
                <p className="text-muted-foreground">
                  📍 {[customer.commune, customer.wilaya].filter(Boolean).join(" — ")}
                </p>
              )}
              {customer.address && <p className="text-muted-foreground truncate">{customer.address}</p>}
            </div>
          </div>

          {/* ── Right: live preview ── */}
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground self-start">
              {isAr ? "معاينة" : "Aperçu"}
            </p>
            <div
              className="relative border rounded-lg overflow-hidden shadow bg-white flex items-start justify-center w-full"
              style={{ aspectRatio: `${cfg.widthMm}/${cfg.heightMm}` }}
            >
              <div style={{
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
                width: `${cfg.widthMm}mm`,
                height: `${cfg.heightMm}mm`,
                position: "absolute", top: 0, left: 0,
              }}>
                <LabelPreview customer={customer} store={storeInfo} cfg={cfg} lang={lang} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {cfg.widthMm} × {cfg.heightMm} mm
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {isAr ? "إلغاء" : "Annuler"}
          </Button>
          <Button
            size="sm"
            className="bg-[#1B3057] hover:bg-[#152544] gap-1.5"
            onClick={handlePrint}
            disabled={printing}
          >
            <Printer className="h-3.5 w-3.5" />
            {printing
              ? (isAr ? "جارٍ التحضير..." : "Préparation...")
              : isAr
                ? `طباعة ${copies} ${copies === 1 ? "نسخة" : "نسخ"}`
                : `Imprimer ${copies} copie${copies > 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
