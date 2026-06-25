import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  useGetProducts, useCreateProduct,
  useUpdateProduct, useDeleteProduct,
  useGenerateProductBarcode,
  getGetProductsQueryKey,
  useGetErpSettingsProductsBrands,
  useGetErpSettingsProductsColors,
  useGetErpSettingsProductsFamilies,
  useGetErpSettingsProductsTypes,
  type Product,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/hooks/use-lang";
import JsBarcode from "jsbarcode";
import { useQueryClient, keepPreviousData, useQuery, useMutation as useRQMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Trash2, Pencil, Plus, Search, Package, ImagePlus, X, Loader2,
  Smartphone, DollarSign, LayoutGrid, Image as ImageIcon, Eye, EyeOff,
  Columns3, Printer, Sparkles, MoreVertical, Copy, Info, Boxes,
  ChevronDown, QrCode, Send, Star, ArrowUp, ArrowDown, FileSpreadsheet,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ProductDetailsDialog from "@/components/ProductDetailsDialog";
import CopyToStoresModal from "@/components/CopyToStoresModal";
import ImportExcelModal from "@/components/ImportExcelModal";

// ── Store identity ──────────────────────────────────────────────────
import { getStoreName } from "@/lib/store-settings";

// ── Barcode rendering ───────────────────────────────────────────────
function BarcodeSvg({
  value, width = 1.6, height = 50, displayValue = true, fontSize = 12, margin = 2,
}: { value: string; width?: number; height?: number; displayValue?: boolean; fontSize?: number; margin?: number }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [barcodeError, setBarcodeError] = useState(false);

  useEffect(() => {
    setBarcodeError(false);
    if (!ref.current) return;
    if (!value) {
      ref.current.innerHTML = "";
      ref.current.setAttribute("data-bc-status", "empty");
      return;
    }
    try {
      JsBarcode(ref.current, value, {
        format: /^\d{13}$/.test(value) ? "EAN13" : "CODE128",
        width, height, displayValue, fontSize, margin,
      });
      ref.current.setAttribute("data-bc-status", "ok");
    } catch {
      if (ref.current) {
        ref.current.innerHTML = "";
        ref.current.setAttribute("data-bc-status", "error");
      }
      setBarcodeError(true);
    }
  }, [value, width, height, displayValue, fontSize, margin]);

  if (barcodeError) {
    return (
      <div style={{ fontSize: "8px", color: "#ef4444", textAlign: "center", padding: "2px 0", fontFamily: "monospace" }}>
        ⚠ {value}
      </div>
    );
  }
  return <svg ref={ref} />;
}

type LabelTarget = { product: Product; qty: number };

// ── Column definitions ──────────────────────────────────────────────────
type ColKey =
  | "id" | "image" | "reference" | "catalogueType" | "designation"
  | "barcode" | "brand" | "model" | "color" | "categoryId"
  | "colisage" | "weight"
  | "catalogue1" | "catalogue2" | "catalogue3" | "catalogue4" | "catalogue5" | "catalogue6"
  | "description" | "createdAt"
  | "isExposed" | "isActive"
  | "price" | "priceGros" | "priceSemiGros" | "priceMin" | "costPrice"
  | "stock" | "vitrine" | "actions";

const ALL_COLUMNS: { key: ColKey; label: string }[] = [
  { key: "id",           label: "Id #" },
  { key: "image",        label: "Image" },
  { key: "reference",    label: "Réf." },
  { key: "catalogueType",label: "Catalogue" },
  { key: "designation",  label: "Désignation" },
  { key: "description",  label: "Description" },
  { key: "barcode",      label: "Code" },
  { key: "brand",        label: "Marque" },
  { key: "model",        label: "Modèle" },
  { key: "color",        label: "Couleur" },
  { key: "categoryId",   label: "Famille" },
  { key: "colisage",     label: "Colisage" },
  { key: "weight",       label: "Poids" },
  { key: "catalogue1",   label: "Catalogue1" },
  { key: "catalogue2",   label: "Catalogue2" },
  { key: "catalogue3",   label: "Catalogue3" },
  { key: "catalogue4",   label: "Catalogue4" },
  { key: "catalogue5",   label: "Catalogue5" },
  { key: "catalogue6",   label: "Catalogue6" },
  { key: "createdAt",    label: "Création" },
  { key: "isExposed",    label: "Exposé" },
  { key: "isActive",     label: "Etat" },
  { key: "price",        label: "PU Détail" },
  { key: "priceGros",    label: "PU Gros" },
  { key: "priceSemiGros",label: "PU S.Gros" },
  { key: "priceMin",     label: "Prix Min" },
  { key: "costPrice",    label: "Coût" },
  { key: "stock",        label: "Stock" },
  { key: "vitrine",      label: "Vitrine" },
  { key: "actions",      label: "Actions" },
];

const DEFAULT_VISIBLE: ColKey[] = [
  "reference", "catalogueType", "designation", "barcode",
  "price", "costPrice", "stock", "vitrine", "actions",
];

function loadVisibleCols(): Set<ColKey> {
  try {
    const raw = localStorage.getItem("erp_product_cols");
    if (raw) return new Set(JSON.parse(raw) as ColKey[]);
  } catch { /* ignore */ }
  return new Set(DEFAULT_VISIBLE);
}
function saveVisibleCols(cols: Set<ColKey>) {
  localStorage.setItem("erp_product_cols", JSON.stringify([...cols]));
}

const NONE_VAL = "__none__";

type GalleryImg = { url: string; isPrimary: boolean };

type ProductForm = {
  nameEn: string; nameAr: string;
  descriptionEn: string; descriptionAr: string;
  price: string; stock: string;
  categoryId: string; imageUrl: string;
  reference: string; barcode: string;
  costPrice: string; catalogueType: string;
  brand: string; model: string; color: string;
  brandId: string; colorId: string; familyId: string;
  colisage: string; weight: string;
  priceGros: string; priceSemiGros: string; priceMin: string;
  catalogue1: string; catalogue2: string; catalogue3: string;
  catalogue4: string; catalogue5: string; catalogue6: string;
  isActive: boolean; isExposed: boolean;
  images: GalleryImg[];
};

const emptyForm: ProductForm = {
  nameEn: "", nameAr: "", descriptionEn: "", descriptionAr: "",
  price: "", stock: "", categoryId: "", imageUrl: "",
  reference: "", barcode: "", costPrice: "", catalogueType: "ARTICLE",
  brand: "", model: "", color: "",
  brandId: "", colorId: "", familyId: "",
  colisage: "1", weight: "",
  priceGros: "", priceSemiGros: "", priceMin: "",
  catalogue1: "", catalogue2: "", catalogue3: "",
  catalogue4: "", catalogue5: "", catalogue6: "",
  isActive: true, isExposed: false,
  images: [],
};

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

function resolveImg(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return `${API_BASE}${url}`;
  return url;
}

const EMPTY_FILTERS = {
  name: "", code: "", brand: "", family: "", stock: "",
  id: "", ref: "", catalogueType: "", description: "", model: "", color: "",
  colisage: "", weight: "",
  catalogue1: "", catalogue2: "", catalogue3: "", catalogue4: "", catalogue5: "", catalogue6: "",
  createdAt: "", exposed: "", active: "",
  price: "", priceGros: "", priceSemiGros: "", priceMin: "", costPrice: "",
} as const;

async function uploadImage(file: File): Promise<string> {
  const token = localStorage.getItem("midanic_token");
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/api/uploads`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json() as { url: string };
  return data.url;
}

function ToggleSwitch({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        checked
          ? "bg-emerald-50 border-emerald-300 text-emerald-700"
          : "bg-gray-50 border-gray-300 text-gray-500"
      }`}
    >
      <span className={`inline-block w-8 h-4 rounded-full relative transition-colors ${checked ? "bg-emerald-500" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${checked ? "left-4" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

export default function Products() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const currency = lang === "ar" ? "دج" : "DA";
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<typeof EMPTY_FILTERS>(() => ({ ...EMPTY_FILTERS }));
  const [debouncedFilters, setDebouncedFilters] = useState<typeof EMPTY_FILTERS>(() => ({ ...EMPTY_FILTERS }));

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 600);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilters(columnFilters), 600);
    return () => clearTimeout(t);
  }, [columnFilters]);

  useEffect(() => { setPage(1); }, [debouncedSearch, pageSize, debouncedFilters]);
  useEffect(() => { setSelected(new Set()); }, [page]);

  const setColumnFilter = (key: keyof typeof columnFilters, value: string) =>
    setColumnFilters((f) => ({ ...f, [key]: value }));
  const clearColumnFilters = () => setColumnFilters({ ...EMPTY_FILTERS });
  const hasActiveFilters = Object.values(columnFilters).some(Boolean);

  const { data: brandsData } = useGetErpSettingsProductsBrands();
  const { data: colorsData } = useGetErpSettingsProductsColors();
  const { data: familiesData } = useGetErpSettingsProductsFamilies();
  const { data: typesData } = useGetErpSettingsProductsTypes();
  // Memoised to prevent new array references on every render (would trigger the
  // auto-name useEffect on every render → infinite setState loop).
  const refBrands = useMemo(() => (brandsData?.items ?? []) as Array<{ id: number; nameFr: string; nameAr: string }>, [brandsData]);
  const refColors = useMemo(() => (colorsData?.items ?? []) as Array<{ id: number; nameFr: string; nameAr: string; hexCode?: string | null }>, [colorsData]);
  const refFamilies = useMemo(() => (familiesData?.items ?? []) as Array<{ id: number; nameFr: string; nameAr: string }>, [familiesData]);
  const catalogueTypes = useMemo(() => (typesData?.items ?? []).map((t) => t.nameFr), [typesData]);

  const { data: productsRes, isLoading } = useGetProducts({
    page,
    limit: pageSize,
    search: debouncedSearch || undefined,
    filterName: debouncedFilters.name || undefined,
    filterCode: debouncedFilters.code || undefined,
    filterBrand: debouncedFilters.brand || undefined,
    filterFamily: debouncedFilters.family || undefined,
    filterStock: debouncedFilters.stock || undefined,
    filterId: debouncedFilters.id || undefined,
    filterRef: debouncedFilters.ref || undefined,
    filterCatalogueType: debouncedFilters.catalogueType || undefined,
    filterDescription: debouncedFilters.description || undefined,
    filterModel: debouncedFilters.model || undefined,
    filterColor: debouncedFilters.color || undefined,
    filterColisage: debouncedFilters.colisage || undefined,
    filterWeight: debouncedFilters.weight || undefined,
    filterCatalogue1: debouncedFilters.catalogue1 || undefined,
    filterCatalogue2: debouncedFilters.catalogue2 || undefined,
    filterCatalogue3: debouncedFilters.catalogue3 || undefined,
    filterCatalogue4: debouncedFilters.catalogue4 || undefined,
    filterCatalogue5: debouncedFilters.catalogue5 || undefined,
    filterCatalogue6: debouncedFilters.catalogue6 || undefined,
    filterCreatedAt: debouncedFilters.createdAt || undefined,
    filterExposed: debouncedFilters.exposed || undefined,
    filterActive: debouncedFilters.active || undefined,
    filterPrice: debouncedFilters.price || undefined,
    filterPriceGros: debouncedFilters.priceGros || undefined,
    filterPriceSemiGros: debouncedFilters.priceSemiGros || undefined,
    filterPriceMin: debouncedFilters.priceMin || undefined,
    filterCostPrice: debouncedFilters.costPrice || undefined,
  }, { query: { placeholderData: keepPreviousData } });
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const generateBarcode = useGenerateProductBarcode();
  const [labelDialog, setLabelDialog] = useState<{ items: LabelTarget[] } | null>(null);
  const [detailsProduct, setDetailsProduct] = useState<Product | null>(null);

  const [dialog, setDialog] = useState<{ open: boolean; editing: Product | null }>({ open: false, editing: null });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [showBarcodeManager, setShowBarcodeManager] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [activeTab, setActiveTab] = useState("general");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [copyModal, setCopyModal] = useState<{ open: boolean; productIds: number[] }>({ open: false, productIds: [] });
  const [importModal, setImportModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imageUrlDraft, setImageUrlDraft] = useState("");
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [visibleCols, setVisibleCols] = useState<Set<ColKey>>(() => loadVisibleCols());
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);
  // Local override map — bypasses React Query cache for immediate UI feedback
  const [exposedMap, setExposedMap] = useState<Map<number, boolean>>(new Map());
  // Local product field overrides for dialog saves
  const [productOverrides, setProductOverrides] = useState<Map<number, Partial<Product>>>(new Map());
  // Row actions dropdown
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [menuProduct, setMenuProduct] = useState<Product | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) {
        setColsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (openMenuId === null) return;
    const closeMenu = () => {
      setOpenMenuId(null);
      setMenuPos(null);
      setMenuProduct(null);
    };
    document.addEventListener("click", closeMenu);
    document.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("scroll", closeMenu, true);
    };
  }, [openMenuId]);

  useEffect(() => {
    const familyName = refFamilies.find((f) => String(f.id) === form.familyId)?.nameFr ?? "";
    const brandName = form.brandId
      ? (refBrands.find((b) => String(b.id) === form.brandId)?.nameFr ?? form.brand)
      : form.brand;
    const colorName = form.colorId
      ? (refColors.find((c) => String(c.id) === form.colorId)?.nameFr ?? form.color)
      : form.color;
    const parts = [familyName, brandName, form.model, colorName].filter(Boolean);
    setForm((f) => ({ ...f, nameEn: parts.join(" ") }));
  }, [form.familyId, form.brand, form.brandId, form.model, form.color, form.colorId, refFamilies, refBrands, refColors]);

  const toggleCol = (key: ColKey) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveVisibleCols(next);
      return next;
    });
  };
  const col = (key: ColKey) => visibleCols.has(key);

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const urls = await Promise.all(files.map((f) => uploadImage(f)));
      setForm((f) => {
        const existing = f.images;
        const added: GalleryImg[] = urls.map((url) => ({ url, isPrimary: false }));
        const next = [...existing, ...added];
        if (next.length > 0 && !next.some((g) => g.isPrimary)) next[0].isPrimary = true;
        return { ...f, images: next, imageUrl: next.find((g) => g.isPrimary)?.url ?? "" };
      });
    } catch {
      setUploadError("فشل رفع الصورة — réessayez");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const galleryAddUrl = (url: string) => {
    const u = url.trim();
    if (!u) return;
    setForm((f) => {
      const next = [...f.images, { url: u, isPrimary: false }];
      if (!next.some((g) => g.isPrimary)) next[0].isPrimary = true;
      return { ...f, images: next, imageUrl: next.find((g) => g.isPrimary)?.url ?? "" };
    });
  };

  const galleryRemove = (idx: number) => {
    setForm((f) => {
      const wasPrimary = f.images[idx]?.isPrimary;
      const next = f.images.filter((_, i) => i !== idx);
      if (wasPrimary && next.length > 0 && !next.some((g) => g.isPrimary)) next[0].isPrimary = true;
      return { ...f, images: next, imageUrl: next.find((g) => g.isPrimary)?.url ?? "" };
    });
  };

  const gallerySetPrimary = (idx: number) => {
    setForm((f) => {
      const next = f.images.map((g, i) => ({ ...g, isPrimary: i === idx }));
      return { ...f, images: next, imageUrl: next[idx]?.url ?? "" };
    });
  };

  const galleryMove = (idx: number, dir: -1 | 1) => {
    setForm((f) => {
      const target = idx + dir;
      if (target < 0 || target >= f.images.length) return f;
      const next = [...f.images];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...f, images: next };
    });
  };

  const products = productsRes?.products ?? [];
  const total = productsRes?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openCreate = () => {
    setForm(emptyForm);
    setImageUrlDraft("");
    setActiveTab("general");
    setDialogError(null);
    setShowBarcodeManager(false);
    setDialog({ open: true, editing: null });
  };
  const openEdit = (p: Product) => {
    const pp = p as Product & { brandId?: number | null; colorId?: number | null; familyId?: number | null; images?: { url: string; isPrimary: boolean; sortOrder: number }[] };
    const gallery: GalleryImg[] = (pp.images && pp.images.length > 0)
      ? [...pp.images].sort((a, b) => a.sortOrder - b.sortOrder).map((im) => ({ url: im.url, isPrimary: im.isPrimary }))
      : (p.imageUrl ? [{ url: p.imageUrl, isPrimary: true }] : []);
    if (gallery.length > 0 && !gallery.some((g) => g.isPrimary)) gallery[0].isPrimary = true;
    setForm({
      nameEn: p.nameEn ?? "", nameAr: p.nameAr ?? "",
      descriptionEn: p.descriptionEn ?? "", descriptionAr: p.descriptionAr ?? "",
      price: String(p.price ?? ""), stock: String(p.stock ?? ""),
      categoryId: String(p.categoryId ?? ""), imageUrl: p.imageUrl ?? "",
      reference: p.reference ?? "", barcode: p.barcode ?? "",
      costPrice: p.costPrice ?? "", catalogueType: p.catalogueType ?? "ARTICLE",
      brand: p.brand ?? "", model: p.model ?? "", color: p.color ?? "",
      brandId: pp.brandId ? String(pp.brandId) : "",
      colorId: pp.colorId ? String(pp.colorId) : "",
      familyId: pp.familyId ? String(pp.familyId) : "",
      colisage: String(p.colisage ?? 1), weight: p.weight ?? "",
      priceGros: p.priceGros ?? "", priceSemiGros: p.priceSemiGros ?? "",
      priceMin: p.priceMin ?? "",
      catalogue1: p.catalogue1 ?? "", catalogue2: p.catalogue2 ?? "",
      catalogue3: p.catalogue3 ?? "", catalogue4: p.catalogue4 ?? "",
      catalogue5: p.catalogue5 ?? "", catalogue6: p.catalogue6 ?? "",
      isActive: p.isActive ?? true, isExposed: p.isExposed ?? false,
      images: gallery,
    });
    setActiveTab("general");
    setDialogError(null);
    setShowBarcodeManager(false);
    setDialog({ open: true, editing: p });
  };

  const handleSave = () => {
    const brandIdInt = form.brandId ? parseInt(form.brandId) : undefined;
    const colorIdInt = form.colorId ? parseInt(form.colorId) : undefined;
    const familyIdInt = form.familyId ? parseInt(form.familyId) : undefined;
    const resolvedBrand = brandIdInt
      ? (refBrands.find((b) => b.id === brandIdInt)?.nameFr ?? form.brand ?? null)
      : (form.brand || null);
    const resolvedColor = colorIdInt
      ? (refColors.find((c) => c.id === colorIdInt)?.nameFr ?? form.color ?? null)
      : (form.color || null);
    const data = {
      nameEn: form.nameEn,
      nameAr: form.nameAr,
      descriptionEn: form.descriptionEn || undefined,
      descriptionAr: form.descriptionAr || undefined,
      price: form.price,
      stock: parseInt(form.stock) || 0,
      categoryId: form.categoryId ? parseInt(form.categoryId) : undefined,
      imageUrl: (form.images.find((g) => g.isPrimary)?.url ?? form.images[0]?.url ?? form.imageUrl) || undefined,
      images: form.images.map((g, i) => ({ url: g.url, sortOrder: i, isPrimary: g.isPrimary })),
      reference: form.reference || null,
      barcode: form.barcode || null,
      catalogueType: form.catalogueType || "ARTICLE",
      brand: resolvedBrand,
      model: form.model || null,
      color: resolvedColor,
      brandId: brandIdInt ?? null,
      colorId: colorIdInt ?? null,
      familyId: familyIdInt ?? null,
      colisage: parseInt(form.colisage) || 1,
      weight: form.weight || null,
      priceGros: form.priceGros || null,
      priceSemiGros: form.priceSemiGros || null,
      priceMin: form.priceMin || null,
      catalogue1: form.catalogue1 || null,
      catalogue2: form.catalogue2 || null,
      catalogue3: form.catalogue3 || null,
      catalogue4: form.catalogue4 || null,
      catalogue5: form.catalogue5 || null,
      catalogue6: form.catalogue6 || null,
      isActive: form.isActive,
      isExposed: form.isExposed,
    };
    const forceRefresh = () => qc.invalidateQueries({ queryKey: getGetProductsQueryKey(), refetchType: "all" });
    const readErr = (err: unknown): string => {
      const e = err as { data?: { error?: string }; message?: string } | undefined;
      return e?.data?.error || e?.message || "Erreur inconnue";
    };
    if (dialog.editing) {
      const editingId = dialog.editing.id;
      updateProduct.mutate({ id: editingId, data }, {
        onSuccess: () => {
          // Immediately store overrides in local state so table updates without waiting for refetch
          setProductOverrides((m) => new Map(m).set(editingId, data as Partial<Product>));
          setDialogError(null);
          setDialog({ open: false, editing: null });
          forceRefresh();
        },
        onError: (err) => setDialogError(`${t("Erreur", "خطأ")}: ${readErr(err)}`),
      });
    } else {
      createProduct.mutate({ data }, {
        onSuccess: () => { forceRefresh(); setDialogError(null); setDialog({ open: false, editing: null }); },
        onError: (err) => setDialogError(`${t("Erreur", "خطأ")}: ${readErr(err)}`),
      });
    }
  };

  const handleDelete = (id: number) => {
    if (!confirm(t("Supprimer ce produit ?", "حذف هذا المنتج؟"))) return;
    deleteProduct.mutate({ id }, {
      onSettled: () => qc.invalidateQueries({ queryKey: getGetProductsQueryKey(), refetchType: "all" })
    });
  };

  const openEditTab = (p: Product, tab: string) => {
    openEdit(p);
    setActiveTab(tab);
  };

  const handleDuplicate = (p: Product) => {
    const forceRefresh = () => qc.invalidateQueries({ queryKey: getGetProductsQueryKey(), refetchType: "all" });
    createProduct.mutate({
      data: {
        nameEn: `${p.nameEn} (copie)`,
        nameAr: p.nameAr ?? undefined,
        descriptionEn: p.descriptionEn ?? undefined,
        descriptionAr: p.descriptionAr ?? undefined,
        price: p.price ?? "0",
        stock: 0,
        categoryId: p.categoryId ?? undefined,
        imageUrl: p.imageUrl ?? undefined,
        reference: p.reference ? `${p.reference}-COPY` : undefined,
        barcode: undefined,
        costPrice: p.costPrice ?? undefined,
        catalogueType: p.catalogueType ?? "ARTICLE",
        brand: p.brand ?? undefined,
        model: p.model ?? undefined,
        color: p.color ?? undefined,
        colisage: p.colisage ?? 1,
        weight: p.weight ?? undefined,
        priceGros: p.priceGros ?? undefined,
        priceSemiGros: p.priceSemiGros ?? undefined,
        priceMin: p.priceMin ?? undefined,
        catalogue1: p.catalogue1 ?? undefined,
        catalogue2: p.catalogue2 ?? undefined,
        catalogue3: p.catalogue3 ?? undefined,
        catalogue4: p.catalogue4 ?? undefined,
        catalogue5: p.catalogue5 ?? undefined,
        catalogue6: p.catalogue6 ?? undefined,
        isActive: p.isActive ?? true,
        isExposed: false,
      }
    }, {
      onSuccess: () => {
        forceRefresh();
        toast({ title: t("Copié", "تم النسخ"), description: `${p.nameEn} ${t("a été dupliqué", "تم نسخه")}` });
      },
      onError: () => toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: t("Échec de la duplication", "فشل النسخ") }),
    });
  };

  const getExposed = (p: Product) =>
    exposedMap.has(p.id) ? exposedMap.get(p.id)! : p.isExposed;

  const toggleVisibility = (p: Product) => {
    const newVal = !getExposed(p);
    // Flip icon immediately via local state — no cache dependency
    setExposedMap((m) => new Map(m).set(p.id, newVal));
    updateProduct.mutate(
      { id: p.id, data: { isExposed: newVal } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetProductsQueryKey(), refetchType: "all" });
          // Keep local override permanently — it matches server truth; cleared on page refresh
        },
        onError: () => {
          // Revert on failure
          setExposedMap((m) => { const n = new Map(m); n.delete(p.id); return n; });
          toast({ variant: "destructive", title: t("Erreur", "خطأ"), description: t("Erreur lors de la mise à jour de la visibilité", "خطأ في تحديث الرؤية") });
        },
      }
    );
  };

  const toggleSelect = (id: number) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleAll = () => {
    if (selected.size === products.length) setSelected(new Set());
    else setSelected(new Set(products.map((p) => p.id)));
  };

  const familyName = (id?: number | null) => {
    const f = refFamilies.find((f) => f.id === id);
    return f ? f.nameFr : "—";
  };

  const catalogueTypeColor = (type?: string | null) => {
    switch (type) {
      case "ARTICLE": return "bg-sky-100 text-sky-700";
      case "PRODUITS": return "bg-violet-100 text-violet-700";
      case "APPAREIL": return "bg-amber-100 text-amber-700";
      case "ACCESSOIRE": return "bg-emerald-100 text-emerald-700";
      case "SERVICE": return "bg-rose-100 text-rose-700";
      case "Vrac": return "bg-orange-100 text-orange-700";
      default: return "bg-gray-100 text-gray-600";
    }
  };

  const sf = (v: string) => (v === NONE_VAL ? "" : v);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6 text-cyan-500" />
            {t("Articles", "المنتجات")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {productsRes?.total ?? 0} {t("article(s) au total", "منتج(ات) في المجموع")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportModal(true)}>
            <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" /> {t("Import Excel", "استيراد Excel")}
          </Button>
          <Button onClick={openCreate} data-testid="button-add-product">
            <Plus className="h-4 w-4 mr-2" /> {t("Nouvel article", "إضافة")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder={t("Rechercher (nom, réf, code)...", "بحث (اسم، مرجع، كود)...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {hasActiveFilters && (
          <Button
            variant="outline" size="sm" className="h-9 gap-2 text-amber-600 border-amber-300 hover:bg-amber-50"
            onClick={clearColumnFilters}
          >
            <X className="h-4 w-4" />
            {t("Effacer filtres", "مسح الفلاتر")}
          </Button>
        )}
        {selected.size > 0 && (
          <>
            <span className="text-sm text-muted-foreground">{selected.size} {t("sélectionné(s)", "محدد(ة)")}</span>
            <Button
              variant="outline" size="sm" className="h-9 gap-2"
              onClick={() => {
                const items: LabelTarget[] = (productsRes?.products ?? [])
                  .filter((p) => selected.has(p.id) && p.barcode)
                  .map((p) => ({ product: p as Product, qty: 1 }));
                if (items.length === 0) {
                  toast({ variant: "destructive", title: t("Aucun code-barres", "لا باركود"), description: t("Aucun article sélectionné n'a de code-barres", "لا يوجد منتج محدد له باركود") });
                  return;
                }
                setLabelDialog({ items });
              }}
              data-testid="button-print-selected"
            >
              <Printer className="h-4 w-4" />
              {t("Imprimer étiquettes", "طباعة")}
            </Button>
            <Button
              variant="outline" size="sm" className="h-9 gap-2"
              onClick={() => setCopyModal({ open: true, productIds: Array.from(selected) })}
            >
              <Send className="h-4 w-4" />
              {t("Envoyer vers magasin", "إرسال إلى متجر")}
            </Button>
          </>
        )}
        {/* Column visibility button */}
        <div ref={colsRef} className="relative ml-auto">
          <Button
            variant="outline" size="sm" className="h-9 gap-2"
            onClick={() => setColsOpen((v) => !v)}
          >
            <Columns3 className="h-4 w-4" />
            {t("Colonnes", "الأعمدة")}
          </Button>
          {colsOpen && (
            <div className="absolute right-0 top-10 z-50 bg-white border rounded-md shadow-lg w-56 p-2 overflow-y-auto" style={{ maxHeight: 420 }}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1 mb-1">
                {t("Afficher les colonnes", "إظهار الأعمدة")}
              </p>
              <div className="space-y-0.5">
                {ALL_COLUMNS.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#1B3057] cursor-pointer"
                      checked={visibleCols.has(c.key)}
                      onChange={() => toggleCol(c.key)}
                    />
                    <span className="text-sm">{c.label}</span>
                  </label>
                ))}
              </div>
              <div className="border-t mt-2 pt-2 flex gap-1">
                <button
                  className="flex-1 h-7 text-xs rounded hover:bg-muted/50 transition-colors"
                  onClick={() => { const s = new Set(ALL_COLUMNS.map(c => c.key) as ColKey[]); setVisibleCols(s); saveVisibleCols(s); }}
                >
                  {t("Tout afficher", "إظهار الكل")}
                </button>
                <button
                  className="flex-1 h-7 text-xs rounded hover:bg-muted/50 transition-colors"
                  onClick={() => { const s = new Set(DEFAULT_VISIBLE); setVisibleCols(s); saveVisibleCols(s); }}
                >
                  {t("Réinitialiser", "إعادة تعيين")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                  {/* ── Column headers ── */}
                  <TableRow className="bg-muted/40">
                    <TableHead className="w-10 px-3">
                      <Checkbox checked={selected.size === products.length && products.length > 0} onCheckedChange={toggleAll} />
                    </TableHead>
                    {col("id")           && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-16">Id #</TableHead>}
                    {col("image")        && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-14">Image</TableHead>}
                    {col("reference")    && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-28">Réf.</TableHead>}
                    {col("catalogueType")&& <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-28">Catalogue</TableHead>}
                    {col("designation")  && <TableHead className="text-xs font-semibold uppercase text-muted-foreground">Désignation</TableHead>}
                    {col("description")  && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-40">Description</TableHead>}
                    {col("barcode")      && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-36">Code</TableHead>}
                    {col("brand")        && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-28">Marque</TableHead>}
                    {col("model")        && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-28">Modèle</TableHead>}
                    {col("color")        && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-24">Couleur</TableHead>}
                    {col("categoryId")   && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-28">Famille</TableHead>}
                    {col("colisage")     && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-20">Colisage</TableHead>}
                    {col("weight")       && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-20">Poids</TableHead>}
                    {col("catalogue1")   && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-24">Cat.1</TableHead>}
                    {col("catalogue2")   && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-24">Cat.2</TableHead>}
                    {col("catalogue3")   && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-24">Cat.3</TableHead>}
                    {col("catalogue4")   && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-24">Cat.4</TableHead>}
                    {col("catalogue5")   && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-24">Cat.5</TableHead>}
                    {col("catalogue6")   && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-24">Cat.6</TableHead>}
                    {col("createdAt")    && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-28">Création</TableHead>}
                    {col("isExposed")    && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-20">Exposé</TableHead>}
                    {col("isActive")     && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-20">Etat</TableHead>}
                    {col("price")        && <TableHead className="text-xs font-semibold uppercase text-muted-foreground text-right w-28">PU Détail</TableHead>}
                    {col("priceGros")    && <TableHead className="text-xs font-semibold uppercase text-muted-foreground text-right w-24">PU Gros</TableHead>}
                    {col("priceSemiGros")&& <TableHead className="text-xs font-semibold uppercase text-muted-foreground text-right w-24">PU S.Gros</TableHead>}
                    {col("priceMin")     && <TableHead className="text-xs font-semibold uppercase text-muted-foreground text-right w-24">Prix Min</TableHead>}
                    {col("costPrice")    && <TableHead className="text-xs font-semibold uppercase text-muted-foreground text-right w-28">Coût</TableHead>}
                    {col("stock")        && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-20">Stock</TableHead>}
                    {col("vitrine")      && <TableHead className="text-xs font-semibold uppercase text-muted-foreground w-20 text-center">Vitrine</TableHead>}
                    {col("actions")      && <TableHead className="w-20" />}
                  </TableRow>
                  {/* ── Filter row ── */}
                  <TableRow className="border-b bg-card h-8">
                    <TableHead className="w-10 px-3" />
                    {col("id")           && <TableHead className="w-16 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.id} onChange={(e) => setColumnFilter("id", e.target.value)} /></div></TableHead>}
                    {col("image")        && <TableHead className="w-14 px-2 py-1" />}
                    {col("reference")    && <TableHead className="w-28 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.ref} onChange={(e) => setColumnFilter("ref", e.target.value)} /></div></TableHead>}
                    {col("catalogueType")&& <TableHead className="w-28 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.catalogueType} onChange={(e) => setColumnFilter("catalogueType", e.target.value)} /></div></TableHead>}
                    {col("designation")  && <TableHead className="px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.name} onChange={(e) => setColumnFilter("name", e.target.value)} /></div></TableHead>}
                    {col("description")  && <TableHead className="w-40 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.description} onChange={(e) => setColumnFilter("description", e.target.value)} /></div></TableHead>}
                    {col("barcode")      && <TableHead className="w-36 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.code} onChange={(e) => setColumnFilter("code", e.target.value)} /></div></TableHead>}
                    {col("brand")        && <TableHead className="w-28 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.brand} onChange={(e) => setColumnFilter("brand", e.target.value)} /></div></TableHead>}
                    {col("model")        && <TableHead className="w-28 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.model} onChange={(e) => setColumnFilter("model", e.target.value)} /></div></TableHead>}
                    {col("color")        && <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.color} onChange={(e) => setColumnFilter("color", e.target.value)} /></div></TableHead>}
                    {col("categoryId")   && <TableHead className="w-28 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.family} onChange={(e) => setColumnFilter("family", e.target.value)} /></div></TableHead>}
                    {col("colisage")     && <TableHead className="w-20 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.colisage} onChange={(e) => setColumnFilter("colisage", e.target.value)} /></div></TableHead>}
                    {col("weight")       && <TableHead className="w-20 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.weight} onChange={(e) => setColumnFilter("weight", e.target.value)} /></div></TableHead>}
                    {col("catalogue1")   && <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.catalogue1} onChange={(e) => setColumnFilter("catalogue1", e.target.value)} /></div></TableHead>}
                    {col("catalogue2")   && <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.catalogue2} onChange={(e) => setColumnFilter("catalogue2", e.target.value)} /></div></TableHead>}
                    {col("catalogue3")   && <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.catalogue3} onChange={(e) => setColumnFilter("catalogue3", e.target.value)} /></div></TableHead>}
                    {col("catalogue4")   && <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.catalogue4} onChange={(e) => setColumnFilter("catalogue4", e.target.value)} /></div></TableHead>}
                    {col("catalogue5")   && <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.catalogue5} onChange={(e) => setColumnFilter("catalogue5", e.target.value)} /></div></TableHead>}
                    {col("catalogue6")   && <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.catalogue6} onChange={(e) => setColumnFilter("catalogue6", e.target.value)} /></div></TableHead>}
                    {col("createdAt")    && <TableHead className="w-28 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.createdAt} onChange={(e) => setColumnFilter("createdAt", e.target.value)} /></div></TableHead>}
                    {col("isExposed")    && <TableHead className="w-20 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="oui/non" value={columnFilters.exposed} onChange={(e) => setColumnFilter("exposed", e.target.value)} /></div></TableHead>}
                    {col("isActive")     && <TableHead className="w-20 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="actif…" value={columnFilters.active} onChange={(e) => setColumnFilter("active", e.target.value)} /></div></TableHead>}
                    {col("price")        && <TableHead className="w-28 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px text-right placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.price} onChange={(e) => setColumnFilter("price", e.target.value)} /></div></TableHead>}
                    {col("priceGros")    && <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px text-right placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.priceGros} onChange={(e) => setColumnFilter("priceGros", e.target.value)} /></div></TableHead>}
                    {col("priceSemiGros")&& <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px text-right placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.priceSemiGros} onChange={(e) => setColumnFilter("priceSemiGros", e.target.value)} /></div></TableHead>}
                    {col("priceMin")     && <TableHead className="w-24 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px text-right placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.priceMin} onChange={(e) => setColumnFilter("priceMin", e.target.value)} /></div></TableHead>}
                    {col("costPrice")    && <TableHead className="w-28 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px text-right placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.costPrice} onChange={(e) => setColumnFilter("costPrice", e.target.value)} /></div></TableHead>}
                    {col("stock")        && <TableHead className="w-20 px-2 py-1"><div className="flex items-center gap-1"><span className="text-[9px] font-medium text-muted-foreground/60 shrink-0">abc</span><input type="text" className="min-w-0 flex-1 bg-transparent border-0 border-b border-muted-foreground/25 rounded-none text-[11px] px-0 pb-px placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60 transition-colors" placeholder="Filtre …" value={columnFilters.stock} onChange={(e) => setColumnFilter("stock", e.target.value)} /></div></TableHead>}
                    {col("vitrine")      && <TableHead className="w-20 px-2 py-1" />}
                    {col("actions")      && <TableHead className="w-20 px-2 py-1" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    [...Array(6)].map((_, i) => (
                      <TableRow key={`skel-${i}`}>
                        <TableCell colSpan={visibleCols.size + 1} className="py-2 px-3">
                          <Skeleton className="h-7 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                  {!isLoading && products.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={visibleCols.size + 1} className="text-center py-12 text-muted-foreground">
                        <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        {t("Aucun article trouvé", "لا توجد نتائج")}
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && products.map((rawP: Product) => {
                    // Merge local overrides so saves reflect immediately in table
                    const p: Product = productOverrides.has(rawP.id)
                      ? { ...rawP, ...productOverrides.get(rawP.id) }
                      : rawP;
                    return (
                    <TableRow
                      key={p.id}
                      data-testid={`row-product-${p.id}`}
                      className={`hover:bg-muted/30 transition-colors ${selected.has(p.id) ? "bg-primary/5" : ""}`}
                    >
                      <TableCell className="px-3">
                        <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} />
                      </TableCell>
                      {col("id")           && <TableCell className="text-xs text-muted-foreground font-mono">{p.id}</TableCell>}
                      {col("image")        && (
                        <TableCell>
                          {p.imageUrl
                            ? <img src={resolveImg(p.imageUrl)} alt="" className="w-8 h-8 rounded object-cover border" />
                            : <div className="w-8 h-8 rounded bg-muted flex items-center justify-center"><ImageIcon className="h-3.5 w-3.5 text-muted-foreground/40" /></div>
                          }
                        </TableCell>
                      )}
                      {col("reference")    && <TableCell className="font-mono text-sm text-muted-foreground">{p.reference ?? "—"}</TableCell>}
                      {col("catalogueType")&& (
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded font-medium ${catalogueTypeColor(p.catalogueType)}`}>
                            {p.catalogueType ?? "ARTICLE"}
                          </span>
                        </TableCell>
                      )}
                      {col("designation")  && (
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {!col("image") && p.imageUrl && (
                              <img src={resolveImg(p.imageUrl)} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0 border" />
                            )}
                            <div>
                              <p className="font-medium text-sm leading-tight">{p.nameEn}</p>
                              {p.nameAr && <p className="text-xs text-muted-foreground" dir="rtl">{p.nameAr}</p>}
                            </div>
                          </div>
                        </TableCell>
                      )}
                      {col("description")  && <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate">{p.descriptionEn ?? "—"}</TableCell>}
                      {col("barcode")      && <TableCell className="font-mono text-xs text-muted-foreground">{p.barcode ?? "—"}</TableCell>}
                      {col("brand")        && <TableCell className="text-sm">{p.brand ?? "—"}</TableCell>}
                      {col("model")        && <TableCell className="text-sm">{p.model ?? "—"}</TableCell>}
                      {col("color")        && <TableCell className="text-sm">{p.color ?? "—"}</TableCell>}
                      {col("categoryId")   && <TableCell className="text-sm">{familyName((p as Product & { familyId?: number | null }).familyId)}</TableCell>}
                      {col("colisage")     && <TableCell className="text-sm text-center">{p.colisage ?? 1}</TableCell>}
                      {col("weight")       && <TableCell className="text-sm">{p.weight ? `${p.weight} kg` : "—"}</TableCell>}
                      {col("catalogue1")   && <TableCell className="text-xs">{p.catalogue1 ?? "—"}</TableCell>}
                      {col("catalogue2")   && <TableCell className="text-xs">{p.catalogue2 ?? "—"}</TableCell>}
                      {col("catalogue3")   && <TableCell className="text-xs">{p.catalogue3 ?? "—"}</TableCell>}
                      {col("catalogue4")   && <TableCell className="text-xs">{p.catalogue4 ?? "—"}</TableCell>}
                      {col("catalogue5")   && <TableCell className="text-xs">{p.catalogue5 ?? "—"}</TableCell>}
                      {col("catalogue6")   && <TableCell className="text-xs">{p.catalogue6 ?? "—"}</TableCell>}
                      {col("createdAt")    && (
                        <TableCell className="text-xs text-muted-foreground">
                          {p.createdAt ? new Date(p.createdAt).toLocaleDateString("fr-DZ") : "—"}
                        </TableCell>
                      )}
                      {col("isExposed")    && (
                        <TableCell className="text-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${p.isExposed ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                            {p.isExposed ? t("Oui", "نعم") : t("Non", "لا")}
                          </span>
                        </TableCell>
                      )}
                      {col("isActive")     && (
                        <TableCell className="text-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${p.isActive !== false ? "bg-sky-100 text-sky-700" : "bg-red-100 text-red-600"}`}>
                            {p.isActive !== false ? t("Actif", "نشط") : t("Inactif", "غير نشط")}
                          </span>
                        </TableCell>
                      )}
                      {col("price")        && (
                        <TableCell className="text-right font-bold text-sm">
                          {p.price ? `${parseFloat(p.price).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} ${currency}` : "—"}
                        </TableCell>
                      )}
                      {col("priceGros")    && (
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {p.priceGros ? `${parseFloat(p.priceGros).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} ${currency}` : "—"}
                        </TableCell>
                      )}
                      {col("priceSemiGros")&& (
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {p.priceSemiGros ? `${parseFloat(p.priceSemiGros).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} ${currency}` : "—"}
                        </TableCell>
                      )}
                      {col("priceMin")     && (
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {p.priceMin ? `${parseFloat(p.priceMin).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} ${currency}` : "—"}
                        </TableCell>
                      )}
                      {col("costPrice")    && (
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {p.costPrice ? `${parseFloat(p.costPrice).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} ${currency}` : "—"}
                        </TableCell>
                      )}
                      {col("stock")        && (
                        <TableCell>
                          <span className={`text-sm font-semibold ${(p.stock ?? 0) === 0 ? "text-red-600" : (p.stock ?? 0) < 5 ? "text-amber-600" : "text-emerald-600"}`}>
                            {p.stock ?? 0}
                          </span>
                        </TableCell>
                      )}
                      {col("vitrine")      && (
                        <TableCell className="text-center">
                          <button
                            onClick={() => toggleVisibility(p)}
                            title={getExposed(p) ? t("Visible — cliquer pour masquer", "مرئي — انقر للإخفاء") : t("Masqué — cliquer pour afficher", "مخفي — انقر للإظهار")}
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                              getExposed(p)
                                ? "bg-emerald-100 text-emerald-600 hover:bg-emerald-200"
                                : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                            }`}
                          >
                            {getExposed(p) ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                        </TableCell>
                      )}
                      {col("actions")      && (
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            data-testid={`btn-edit-${p.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (openMenuId === p.id) {
                                setOpenMenuId(null);
                                setMenuPos(null);
                                setMenuProduct(null);
                              } else {
                                const MENU_W = 208;
                                const MENU_H = 292;
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const x = rect.right + MENU_W > window.innerWidth
                                  ? rect.left - MENU_W
                                  : rect.left;
                                const y = rect.bottom + MENU_H > window.innerHeight
                                  ? rect.top - MENU_H
                                  : rect.bottom + 4;
                                setMenuPos({ x, y });
                                setMenuProduct(p);
                                setOpenMenuId(p.id);
                              }
                            }}
                            title="الإجراءات"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
        </CardContent>
      </Card>

      {/* ===== PAGINATION ===== */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <span className="text-sm text-muted-foreground">
          {total === 0
            ? "Aucun article trouvé"
            : `Affichage ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} sur ${total} article(s)`}
        </span>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Lignes :</span>
            <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100, 200].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline" size="sm" className="h-8 px-2 text-xs"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              ← Préc.
            </Button>
            {(() => {
              const pages: (number | "...")[] = [];
              if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) pages.push(i);
              } else {
                pages.push(1);
                if (page > 3) pages.push("...");
                for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
                if (page < totalPages - 2) pages.push("...");
                pages.push(totalPages);
              }
              return pages.map((pg, i) =>
                pg === "..." ? (
                  <span key={`e${i}`} className="px-1 text-muted-foreground text-xs select-none">…</span>
                ) : (
                  <Button
                    key={pg}
                    variant={pg === page ? "default" : "outline"}
                    size="sm"
                    className={`h-8 w-8 p-0 text-xs ${pg === page ? "bg-[#1B3057] hover:bg-[#1B3057]/90" : ""}`}
                    onClick={() => setPage(pg as number)}
                  >
                    {pg}
                  </Button>
                )
              );
            })()}
            <Button
              variant="outline" size="sm" className="h-8 px-2 text-xs"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Suiv. →
            </Button>
          </div>
        </div>
      </div>

      {/* ===== ROW ACTION MENU PORTAL ===== */}
      {openMenuId !== null && menuPos !== null && menuProduct !== null && createPortal(
        <div
          style={{ position: "fixed", top: menuPos.y, left: menuPos.x, zIndex: 9999 }}
          className="w-52 rounded-md border bg-white shadow-lg py-1 text-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-right"
            onClick={() => { setOpenMenuId(null); setMenuPos(null); setMenuProduct(null); openEditTab(menuProduct, "general"); }}
          >
            <Pencil className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t("Modifier", "تعديل المنتج")}</span>
          </button>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-right"
            onClick={() => { setOpenMenuId(null); setMenuPos(null); setMenuProduct(null); openEditTab(menuProduct, "images"); }}
          >
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t("Images", "الصور")}</span>
          </button>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-right"
            onClick={() => { setOpenMenuId(null); setMenuPos(null); setMenuProduct(null); handleDuplicate(menuProduct); }}
          >
            <Copy className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t("Dupliquer", "نسخ المنتج")}</span>
          </button>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-right"
            onClick={() => { const pid = menuProduct.id; setOpenMenuId(null); setMenuPos(null); setMenuProduct(null); setCopyModal({ open: true, productIds: [pid] }); }}
          >
            <Send className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t("Envoyer vers magasin", "إرسال إلى متجر")}</span>
          </button>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-right"
            onClick={() => { setOpenMenuId(null); setMenuPos(null); setMenuProduct(null); setDetailsProduct(menuProduct); }}
          >
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t("Détails", "تفاصيل المنتج")}</span>
          </button>
          <div className="my-1 border-t" />
          <button
            className={`flex w-full items-center gap-2.5 px-3 py-2 transition-colors text-right ${menuProduct.barcode ? "hover:bg-muted/60" : "opacity-40 cursor-not-allowed"}`}
            disabled={!menuProduct.barcode}
            onClick={() => {
              if (!menuProduct.barcode) return;
              setOpenMenuId(null);
              setMenuPos(null);
              setLabelDialog({ items: [{ product: menuProduct, qty: 1 }] });
              setMenuProduct(null);
            }}
          >
            <Printer className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t("Imprimer code-barres", "طباعة الباركود")}</span>
          </button>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-right"
            onClick={() => { setOpenMenuId(null); setMenuPos(null); setMenuProduct(null); openEditTab(menuProduct, "general"); }}
          >
            <Boxes className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t("Gestion stock", "إدارة المخزون")}</span>
          </button>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-right"
            onClick={() => { setOpenMenuId(null); setMenuPos(null); setMenuProduct(null); openEditTab(menuProduct, "pricing"); }}
          >
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{t("Prix", "الأسعار")}</span>
          </button>
          <div className="my-1 border-t" />
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 hover:bg-red-50 text-red-600 transition-colors text-right"
            onClick={() => { const id = menuProduct.id; setOpenMenuId(null); setMenuPos(null); setMenuProduct(null); handleDelete(id); }}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" />
            <span>{t("Supprimer", "حذف المنتج")}</span>
          </button>
        </div>,
        document.body
      )}

      {/* ===== DIALOG ===== */}
      <Dialog open={dialog.open} onOpenChange={(v) => { setDialog((d) => ({ ...d, open: v })); if (!v) setShowBarcodeManager(false); }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b">
            <DialogHeader className="flex-1">
              <DialogTitle className="text-base font-bold">
                {dialog.editing
                  ? `${t("Modifier article n°", "تعديل المنتج رقم")}${dialog.editing.id}`
                  : t("Nouvel article", "منتج جديد")}
              </DialogTitle>
            </DialogHeader>
            <div className="flex items-center gap-2 mr-4">
              <ToggleSwitch
                checked={form.isActive}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                label="Activé"
              />
              <ToggleSwitch
                checked={form.isExposed}
                onCheckedChange={(v) => setForm((f) => ({ ...f, isExposed: v }))}
                label={form.isExposed ? t("🌐 Visible en vitrine", "🌐 مرئي في الواجهة") : t("🚫 Masqué du magasin", "🚫 مخفي من المتجر")}
              />
              <Button
                onClick={handleSave}
                disabled={createProduct.isPending || updateProduct.isPending || !form.nameEn || !form.price}
                size="sm"
                data-testid="button-save-product"
                className="bg-[#1B3057] hover:bg-[#1B3057]/90"
              >
                {t("Enregistrer", "حفظ")}
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
            <div className="px-6 border-b bg-muted/30">
              <TabsList className="h-10 bg-transparent gap-1 p-0">
                <TabsTrigger value="general" className="flex items-center gap-1.5 data-[state=active]:border-b-2 data-[state=active]:border-[#1B3057] rounded-none h-10 text-xs px-3">
                  <Smartphone className="h-3.5 w-3.5" /> GÉNÉRAL
                </TabsTrigger>
                <TabsTrigger value="pricing" className="flex items-center gap-1.5 data-[state=active]:border-b-2 data-[state=active]:border-[#1B3057] rounded-none h-10 text-xs px-3">
                  <DollarSign className="h-3.5 w-3.5" /> PRICING
                </TabsTrigger>
                <TabsTrigger value="catalogues" className="flex items-center gap-1.5 data-[state=active]:border-b-2 data-[state=active]:border-[#1B3057] rounded-none h-10 text-xs px-3">
                  <LayoutGrid className="h-3.5 w-3.5" /> CATALOGUES
                </TabsTrigger>
                <TabsTrigger value="images" className="flex items-center gap-1.5 data-[state=active]:border-b-2 data-[state=active]:border-[#1B3057] rounded-none h-10 text-xs px-3">
                  <ImageIcon className="h-3.5 w-3.5" /> IMAGES
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto">

              {/* ── GÉNÉRAL ── */}
              <TabsContent value="general" className="m-0 p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-[#1B3057]">
                    <Package className="h-4 w-4" /> {t("Informations générales", "معلومات عامة")}
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">{t("Type d'identification", "نوع التعريف")}</Label>
                      <Select value={form.catalogueType} onValueChange={(v) => setForm((f) => ({ ...f, catalogueType: sf(v) }))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {catalogueTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">{t("Code à barres", "باركود")}</Label>
                      <div className="flex gap-1">
                        <Input
                          value={form.barcode}
                          onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                          placeholder="5420008643231"
                          className="h-8 text-sm font-mono flex-1"
                          data-testid="input-barcode"
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button" size="sm" variant="outline"
                              className="h-8 px-2 shrink-0 gap-0.5"
                              disabled={generateBarcode.isPending}
                              data-testid="button-generate-barcode"
                            >
                              {generateBarcode.isPending
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Sparkles className="h-3.5 w-3.5" />}
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem
                              onSelect={() => {
                                generateBarcode.mutate(undefined, {
                                  onSuccess: (r) => setForm((f) => ({ ...f, barcode: r.barcode })),
                                  onError: (e) => {
                                    const err = e as { data?: { error?: string }; message?: string };
                                    setDialogError(`${t("Erreur", "خطأ")}: ${err?.data?.error || err?.message || t("Echec génération", "فشل الإنشاء")}`);
                                  },
                                });
                              }}
                            >
                              <Sparkles className="h-3.5 w-3.5 mr-2" />
                              {t("Générer automatiquement", "إنشاء تلقائي")}
                            </DropdownMenuItem>
                            {dialog.editing && (
                              <DropdownMenuItem
                                onSelect={() => setShowBarcodeManager((v) => !v)}
                              >
                                <QrCode className="h-3.5 w-3.5 mr-2" />
                                {showBarcodeManager ? t("Masquer les barcodes", "إخفاء الباركودات") : t("Barcodes multiples", "إضافة باركودات")}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {form.barcode && (
                        <div className="mt-2 flex items-center gap-2 bg-white border rounded p-1.5">
                          <BarcodeSvg value={form.barcode} height={32} fontSize={9} width={1.2} />
                          {dialog.editing && (
                            <Button
                              type="button" size="sm" variant="ghost"
                              className="h-7 px-2 ml-auto"
                              onClick={() => setLabelDialog({ items: [{ product: { ...dialog.editing!, barcode: form.barcode, reference: form.reference, price: form.price, nameEn: form.nameEn, nameAr: form.nameAr }, qty: 1 }] })}
                              title={t("Imprimer étiquette", "طباعة الملصق")}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    {/* ── Inline extra barcodes panel (shown when toggled) ─── */}
                    {showBarcodeManager && dialog.editing && (
                      <BarcodeManagerPanel productId={dialog.editing.id} />
                    )}
                    <div>
                      <Label className="text-xs mb-1 block">{t("Réf.", "المرجع")}</Label>
                      <Input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} placeholder="23102-E" className="h-8 text-sm font-mono" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div>
                      <Label className="text-xs mb-1 block">Désignation (FR/EN) *</Label>
                      <Input value={form.nameEn} onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))} placeholder="Nom du produit" className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">الاسم (AR) *</Label>
                      <Input value={form.nameAr} onChange={(e) => setForm((f) => ({ ...f, nameAr: e.target.value }))} dir="rtl" placeholder="اسم المنتج" className="h-8 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 mt-3">
                    <div>
                      <Label className="text-xs mb-1 block">{t("Marque", "الماركة")}</Label>
                      {refBrands.length > 0 ? (
                        <Select
                          value={form.brandId || NONE_VAL}
                          onValueChange={(v) => {
                            const val = sf(v);
                            const brand = refBrands.find((b) => String(b.id) === val);
                            setForm((f) => ({ ...f, brandId: val, brand: brand?.nameFr ?? f.brand }));
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE_VAL}>— Aucune marque</SelectItem>
                            {refBrands.map((b) => (
                              <SelectItem key={b.id} value={String(b.id)}>
                                {b.nameFr}
                                {b.nameAr && <span className="ml-2 text-xs text-muted-foreground" dir="rtl">/ {b.nameAr}</span>}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} placeholder="Ex: L'Oréal" className="h-8 text-sm" />
                      )}
                      {refBrands.length > 0 && (
                        <Input
                          value={form.brand}
                          onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value, brandId: "" }))}
                          placeholder="Ou saisir librement…"
                          className="h-7 text-xs mt-1 text-muted-foreground"
                        />
                      )}
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">{t("Modèle", "الموديل")}</Label>
                      <Input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="Ex: ESPAGNE" className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">{t("Couleur", "اللون")}</Label>
                      {refColors.length > 0 ? (
                        <Select
                          value={form.colorId || NONE_VAL}
                          onValueChange={(v) => {
                            const val = sf(v);
                            const color = refColors.find((c) => String(c.id) === val);
                            setForm((f) => ({ ...f, colorId: val, color: color?.nameFr ?? f.color }));
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE_VAL}>— Aucune couleur</SelectItem>
                            {refColors.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                <div className="flex items-center gap-2">
                                  {c.hexCode && (
                                    <span className="inline-block w-3 h-3 rounded-full border" style={{ backgroundColor: c.hexCode }} />
                                  )}
                                  {c.nameFr}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} placeholder="Ex: Noir" className="h-8 text-sm" />
                      )}
                      {refColors.length > 0 && (
                        <Input
                          value={form.color}
                          onChange={(e) => setForm((f) => ({ ...f, color: e.target.value, colorId: "" }))}
                          placeholder="Ou saisir librement…"
                          className="h-7 text-xs mt-1 text-muted-foreground"
                        />
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-3 mt-3">
                    <div>
                      <Label className="text-xs mb-1 block">{t("Famille", "العائلة")}</Label>
                      <Select
                        value={form.familyId || NONE_VAL}
                        onValueChange={(v) => setForm((f) => ({ ...f, familyId: sf(v) }))}
                      >
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="— Aucune famille" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_VAL}>— Aucune famille</SelectItem>
                          {refFamilies.map((fam) => (
                            <SelectItem key={fam.id} value={String(fam.id)}>
                              {fam.nameFr}
                              {fam.nameAr && <span className="ml-2 text-xs text-muted-foreground" dir="rtl">/ {fam.nameAr}</span>}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Stock</Label>
                      <Input type="number" min="0" value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Colisage</Label>
                      <Input type="number" min="1" value={form.colisage} onChange={(e) => setForm((f) => ({ ...f, colisage: e.target.value }))} className="h-8 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">Poids (kg)</Label>
                      <Input type="number" min="0" step="0.001" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} className="h-8 text-sm" />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-[#1B3057]">
                    <Pencil className="h-4 w-4" /> Description e-commerce
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1 block">Description (FR/EN)</Label>
                      <textarea
                        value={form.descriptionEn}
                        onChange={(e) => setForm((f) => ({ ...f, descriptionEn: e.target.value }))}
                        rows={3}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                      />
                    </div>
                    <div>
                      <Label className="text-xs mb-1 block">الوصف (AR)</Label>
                      <textarea
                        value={form.descriptionAr}
                        onChange={(e) => setForm((f) => ({ ...f, descriptionAr: e.target.value }))}
                        dir="rtl"
                        rows={3}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                      />
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* ── PRICING ── */}
              <TabsContent value="pricing" className="m-0 p-5">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-4 text-[#1B3057]">
                  <DollarSign className="h-4 w-4" /> {t("Gestion des prix", "الأسعار")}
                </h3>
                {form.costPrice && form.price && parseFloat(form.price) < parseFloat(form.costPrice) && (
                  <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-md px-3 py-2 text-xs">
                    ⚠️ {t("Attention: Certains prix sont inférieurs au coût !", "تحذير: بعض الأسعار أقل من التكلفة!")}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {t("Coût (CUMP)", "التكلفة (م.م.م)")}
                    </Label>
                    <div className="flex items-center gap-1">
                      <div className="h-10 flex-1 flex items-center px-3 rounded-md border bg-muted/40 text-sm select-none">
                        {form.costPrice
                          ? `${parseFloat(form.costPrice).toLocaleString("fr-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : <span className="text-muted-foreground/60 text-xs italic">{t("Calculé auto. à la réception", "يُحسب تلقائياً عند الاستلام")}</span>
                        }
                      </div>
                      <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">DZD</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground/60">
                      {t("Mis à jour automatiquement à chaque réception d'un bon d'achat.", "يُحدَّث تلقائياً عند استلام كل طلبية شراء (CUMP).")}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("PU Détail", "سعر البيع")} *</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" min="0" step="0.01"
                        value={form.price}
                        onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                        className="h-10 text-sm font-semibold"
                        placeholder="0,00"
                      />
                      <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">DZD</span>
                    </div>
                    {form.costPrice && form.price && (
                      <p className="text-xs text-muted-foreground">
                        Marge: {(((parseFloat(form.price) - parseFloat(form.costPrice)) / parseFloat(form.costPrice)) * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">PU Gros</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" min="0" step="0.01"
                        value={form.priceGros}
                        onChange={(e) => setForm((f) => ({ ...f, priceGros: e.target.value }))}
                        className="h-10 text-sm"
                        placeholder="0,00"
                      />
                      <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">DZD</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">PU Semi-Gros</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" min="0" step="0.01"
                        value={form.priceSemiGros}
                        onChange={(e) => setForm((f) => ({ ...f, priceSemiGros: e.target.value }))}
                        className="h-10 text-sm"
                        placeholder="0,00"
                      />
                      <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">DZD</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prix Min.</Label>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number" min="0" step="0.01"
                        value={form.priceMin}
                        onChange={(e) => setForm((f) => ({ ...f, priceMin: e.target.value }))}
                        className="h-10 text-sm"
                        placeholder="0,00"
                      />
                      <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">DZD</span>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* ── CATALOGUES ── */}
              <TabsContent value="catalogues" className="m-0 p-5">
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-4 text-[#1B3057]">
                  <LayoutGrid className="h-4 w-4" /> {t("Configuration de l'article", "تصنيفات المنتج")}
                </h3>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Catégories</p>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { key: "catalogue1", label: "Catalogue 1" },
                      { key: "catalogue2", label: "Catalogue 2" },
                      { key: "catalogue3", label: "Catalogue 3" },
                      { key: "catalogue4", label: "Catalogue 4" },
                      { key: "catalogue5", label: "Catalogue 5" },
                      { key: "catalogue6", label: "Catalogue 6" },
                    ] as const).map(({ key, label }) => (
                      <div key={key} className="border rounded-lg p-3">
                        <Label className="text-xs font-semibold mb-2 block text-muted-foreground">{label}</Label>
                        <Select
                          value={form[key] || NONE_VAL}
                          onValueChange={(v) => setForm((f) => ({ ...f, [key]: sf(v) }))}
                        >
                          <SelectTrigger className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE_VAL}>
                              <span className="flex items-center gap-1.5 text-muted-foreground">
                                <Plus className="h-3 w-3" /> Aucun
                              </span>
                            </SelectItem>
                            {catalogueTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>

              {/* ── IMAGES ── */}
              <TabsContent value="images" className="m-0 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-[#1B3057]">
                    <ImageIcon className="h-4 w-4" /> {t("Galerie d'images", "معرض الصور")}
                    <span className="text-xs font-normal text-muted-foreground">({form.images.length})</span>
                  </h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> {t("Chargement...", "جاري التحميل...")}</>
                    ) : (
                      <><ImagePlus className="h-3.5 w-3.5 mr-1" /> {t("Ajouter des images", "إضافة صور")}</>
                    )}
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleImagePick}
                />
                {uploadError && <p className="text-xs text-destructive mb-3">{uploadError}</p>}

                {form.images.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {form.images.map((img, idx) => (
                      <div
                        key={`${img.url}-${idx}`}
                        className={`relative group rounded-xl overflow-hidden border-2 transition-colors ${
                          img.isPrimary ? "border-[#1B3057]" : "border-muted-foreground/15"
                        }`}
                      >
                        <div className="aspect-square bg-muted/20">
                          <img src={resolveImg(img.url)} alt="" className="w-full h-full object-cover" />
                        </div>
                        {img.isPrimary && (
                          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#1B3057] text-white text-[10px] font-medium">
                            <Star className="h-2.5 w-2.5 fill-current" /> {t("Principale", "رئيسية")}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setPendingDeleteIdx(idx)}
                          className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/55 hover:bg-destructive text-white flex items-center justify-center transition-colors"
                          title={t("Supprimer", "حذف")}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/55 px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="flex gap-0.5">
                            <button
                              type="button"
                              onClick={() => galleryMove(idx, -1)}
                              disabled={idx === 0}
                              className="h-5 w-5 rounded text-white hover:bg-white/20 disabled:opacity-30 flex items-center justify-center"
                              title={t("Déplacer à gauche", "تحريك لليسار")}
                            >
                              <ArrowUp className="h-3 w-3 -rotate-90" />
                            </button>
                            <button
                              type="button"
                              onClick={() => galleryMove(idx, 1)}
                              disabled={idx === form.images.length - 1}
                              className="h-5 w-5 rounded text-white hover:bg-white/20 disabled:opacity-30 flex items-center justify-center"
                              title={t("Déplacer à droite", "تحريك لليمين")}
                            >
                              <ArrowDown className="h-3 w-3 -rotate-90" />
                            </button>
                          </div>
                          {!img.isPrimary && (
                            <button
                              type="button"
                              onClick={() => gallerySetPrimary(idx)}
                              className="h-5 px-1.5 rounded text-white hover:bg-white/20 flex items-center gap-1 text-[10px]"
                              title={t("Définir comme principale", "تعيين كرئيسية")}
                            >
                              <Star className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    className="flex flex-col items-center justify-center h-40 text-center border-2 border-dashed border-muted-foreground/20 rounded-xl cursor-pointer hover:bg-muted/20 transition-colors"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">{t("Aucune image", "لا توجد صور")}</p>
                    <p className="text-xs text-muted-foreground/60">{t("Cliquez pour ajouter des images", "اضغط لإضافة صور")}</p>
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <Input
                    value={imageUrlDraft}
                    onChange={(e) => setImageUrlDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); galleryAddUrl(imageUrlDraft); setImageUrlDraft(""); } }}
                    className="h-8 text-xs"
                    placeholder={t("ou coller une URL d'image...", "أو الصق رابط الصورة...")}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-8 shrink-0"
                    onClick={() => { galleryAddUrl(imageUrlDraft); setImageUrlDraft(""); }}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> {t("Ajouter", "إضافة")}
                  </Button>
                </div>

                <AlertDialog open={pendingDeleteIdx !== null} onOpenChange={(open) => { if (!open) setPendingDeleteIdx(null); }}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("Supprimer cette image ?", "حذف هذه الصورة؟")}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {t(
                          "Cette image sera retirée de la galerie. Si c'est l'image principale, une autre sera définie automatiquement.",
                          "ستتم إزالة هذه الصورة من المعرض. إذا كانت الصورة الرئيسية، سيتم تعيين صورة أخرى تلقائياً."
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel onClick={() => setPendingDeleteIdx(null)}>
                        {t("Annuler", "إلغاء")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => {
                          if (pendingDeleteIdx !== null) {
                            galleryRemove(pendingDeleteIdx);
                            setPendingDeleteIdx(null);
                          }
                        }}
                      >
                        {t("Supprimer", "حذف")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TabsContent>

            </div>
          </Tabs>

          {/* Footer */}
          <div className="border-t bg-muted/20">
            {dialogError && (
              <p className="px-6 py-2 text-xs text-red-600 bg-red-50 border-b border-red-100">
                {dialogError}
              </p>
            )}
            <div className="flex justify-between items-center px-6 py-3">
              <Button variant="ghost" size="sm" onClick={() => { setDialogError(null); setDialog({ open: false, editing: null }); }}>
                {t("Annuler", "إلغاء")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={createProduct.isPending || updateProduct.isPending || !form.nameEn || !form.price}
                size="sm"
                data-testid="button-save-product-footer"
                className="bg-[#1B3057] hover:bg-[#1B3057]/90"
              >
                {t("Enregistrer", "حفظ")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {labelDialog && (
        <PrintLabelsDialog
          items={labelDialog.items}
          onClose={() => setLabelDialog(null)}
        />
      )}


      <ProductDetailsDialog
        product={detailsProduct}
        onClose={() => setDetailsProduct(null)}
      />

      <CopyToStoresModal
        open={copyModal.open}
        onClose={() => setCopyModal({ open: false, productIds: [] })}
        productIds={copyModal.productIds}
        products={products}
      />

      <ImportExcelModal
        open={importModal}
        onClose={() => setImportModal(false)}
        onImported={() => { queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() }); }}
      />
    </div>
  );
}

// ── Extra Barcodes Manager Panel (inline — no nested Dialog) ──────────
function BarcodeManagerPanel({ productId }: { productId: number }) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  const tok = () => localStorage.getItem("midanic_token") ?? "";

  const { data: list = [], refetch, isLoading } = useQuery<Array<{ id: number; barcode: string }>>({
    queryKey: ["extra-barcodes", productId],
    queryFn: async () => {
      const r = await fetch(`${apiBase}/api/erp/products/${productId}/barcodes`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      return r.json() as Promise<Array<{ id: number; barcode: string }>>;
    },
  });

  const add = useRQMutation({
    mutationFn: async (barcode: string) => {
      const r = await fetch(`${apiBase}/api/erp/products/${productId}/barcodes`, {
        method: "POST",
        headers: { Authorization: `Bearer ${tok()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ barcode }),
      });
      const d = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
    },
    onSuccess: () => { setInput(""); setErr(null); void refetch(); },
    onError: (e) => setErr((e as Error).message),
  });

  const del = useRQMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${apiBase}/api/erp/products/${productId}/barcodes/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${tok()}` },
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
    },
    onSuccess: () => { void refetch(); },
    onError: (e) => setErr((e as Error).message),
  });

  const handleAdd = () => {
    const bc = input.trim();
    if (!bc) return;
    setErr(null);
    add.mutate(bc);
  };

  return (
    <div className="border rounded-lg p-3 bg-gray-50 space-y-2 mt-1">
      <p className="text-xs font-semibold text-muted-foreground">
        {t("Barcodes supplémentaires", "باركودات إضافية")}
      </p>
      {/* Add row */}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => { setInput(e.target.value); setErr(null); }}
          placeholder="Ex: 5420008643231"
          className="h-8 text-sm font-mono flex-1"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
        />
        <Button
          type="button"
          size="sm"
          className="h-8 px-3 shrink-0"
          disabled={add.isPending || !input.trim()}
          onClick={handleAdd}
        >
          {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}

      {isLoading && (
        <div className="flex justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      {!isLoading && list.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          {t("Aucun barcode supplémentaire", "لا توجد باركودات إضافية")}
        </p>
      )}
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {list.map((b) => (
          <div key={b.id} className="flex items-center gap-2 border rounded p-1.5 bg-white">
            <div className="flex-1 min-w-0">
              <BarcodeSvg value={b.barcode} height={24} fontSize={7} width={1.0} />
              <p className="font-mono text-[10px] text-center text-muted-foreground truncate">{b.barcode}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-red-500 hover:text-red-600 shrink-0"
              onClick={() => del.mutate(b.id)}
              disabled={del.isPending}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Label size definitions ───────────────────────────────────────────
type LabelSize = "xsmall" | "small" | "medium" | "large" | "xlarge";

const LABEL_DIMS: Record<LabelSize, {
  w: string; h: string;
  barH: number; barW: number; font: number; name: string; barMargin: number;
}> = {
  xsmall: { w: "30mm",  h: "20mm", barH: 32,  barW: 0.9, font: 7,  name: "8px",  barMargin: 1 },
  small:  { w: "40mm",  h: "25mm", barH: 55,  barW: 1.2, font: 8,  name: "10px", barMargin: 1 },
  medium: { w: "60mm",  h: "35mm", barH: 72,  barW: 1.6, font: 10, name: "12px", barMargin: 1 },
  large:  { w: "80mm",  h: "50mm", barH: 100, barW: 2.0, font: 12, name: "13px", barMargin: 1 },
  xlarge: { w: "100mm", h: "60mm", barH: 130, barW: 2.5, font: 14, name: "14px", barMargin: 1 },
};

// ── Print Labels Dialog ─────────────────────────────────────────────
function PrintLabelsDialog({
  items, onClose,
}: { items: LabelTarget[]; onClose: () => void }) {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const { toast } = useToast();
  const currency = lang === "ar" ? "دج" : "DA";
  const [size, setSize] = useState<LabelSize>("medium");
  const [rows, setRows] = useState<LabelTarget[]>(items);
  const [showPrice, setShowPrice] = useState(true);
  const [showReference, setShowReference] = useState(true);
  const [showStoreName, setShowStoreName] = useState(false);
  const [priceOnly, setPriceOnly] = useState(false);
  const [barHeightOverride, setBarHeightOverride] = useState<number>(LABEL_DIMS.medium.barH);
  const [barFontOverride, setBarFontOverride] = useState<number>(LABEL_DIMS.medium.font);

  const setQty = (idx: number, qty: number) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, qty: Math.max(1, qty) } : r)));

  const allLabels = useMemo<Product[]>(
    () => rows.flatMap((r) => Array.from({ length: r.qty }, () => r.product)),
    [rows],
  );

  const dims = LABEL_DIMS[size];

  // Reset barcode overrides to the size's defaults whenever size changes
  useEffect(() => {
    setBarHeightOverride(LABEL_DIMS[size].barH);
    setBarFontOverride(LABEL_DIMS[size].font);
  }, [size]);

  const handlePrint = () => {
    const area = document.getElementById("midanic-print-area");
    if (!area) {
      toast({
        variant: "destructive",
        title: t("Erreur", "خطأ"),
        description: t("Zone d'impression introuvable.", "تعذر إيجاد منطقة الطباعة."),
      });
      return;
    }

    // Wait until every BarcodeSvg <svg> has set data-bc-status (ok / empty / error)
    // This avoids the 2-second hang when invalid/empty barcodes leave SVGs with no children
    const tryPrint = (tries = 0) => {
      const svgs = Array.from(area.querySelectorAll<SVGSVGElement>("svg"));
      // priceOnly mode has no SVGs — proceed immediately
      const ready = svgs.length === 0 || svgs.every((s) => s.hasAttribute("data-bc-status"));
      if (!ready && tries < 40) { setTimeout(() => tryPrint(tries + 1), 50); return; }

      // Open a dedicated print window — bypasses Dialog portal / transform-context issues
      const pw = window.open("", "_blank", "width=960,height=720");
      if (!pw) {
        toast({
          variant: "destructive",
          title: t("Pop-up bloqué", "النوافذ المنبثقة محجوبة"),
          description: t(
            "Autorisez les pop-ups dans votre navigateur pour imprimer.",
            "يرجى السماح بالنوافذ المنبثقة في إعدادات متصفحك للطباعة."
          ),
        });
        return;
      }

      const gridDiv = area.querySelector("div");
      const labelsHtml = gridDiv ? gridDiv.innerHTML : area.innerHTML;

      const css = [
        "*{box-sizing:border-box;margin:0;padding:0}",
        "body{background:#fff;font-family:Arial,Helvetica,sans-serif;",
        "-webkit-print-color-adjust:exact;print-color-adjust:exact}",
        ".border{border-width:1px;border-style:solid}.border-gray-300{border-color:#d1d5db}",
        ".rounded{border-radius:0.25rem}.p-1{padding:0.25rem}",
        ".flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1 1 0%}",
        ".items-center{align-items:center}.justify-center{justify-content:center}",
        ".text-center{text-align:center}.bg-white{background-color:#fff}",
        ".font-semibold{font-weight:600}.font-bold{font-weight:700}",
        ".font-black{font-weight:900}.font-medium{font-weight:500}",
        ".font-mono{font-family:monospace}",
        ".leading-tight{line-height:1.25}.leading-none{line-height:1}",
        ".truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
        ".w-full{width:100%}.mt-auto{margin-top:auto}",
        ".uppercase{text-transform:uppercase}.tracking-wide{letter-spacing:0.05em}",
        ".text-muted-foreground{color:#6b7280}",
        // Tailwind arbitrary-value classes (brackets must be escaped in CSS selectors)
        ".text-\\[8px\\]{font-size:8px}",
        ".mb-0\\.5{margin-bottom:0.125rem}",
        "svg{max-width:100%;display:block;margin:0 auto}",
        "@page{margin:6mm;size:auto}",
      ].join("");

      pw.document.open();
      pw.document.write(
        `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/>` +
        `<title>Étiquettes Midanic</title><style>${css}</style></head><body>` +
        `<div style="display:grid;gap:4mm;` +
        `grid-template-columns:repeat(auto-fill,minmax(${dims.w},1fr));padding:4mm">` +
        `${labelsHtml}</div>` +
        `<script>window.onload=function(){setTimeout(function(){window.print();window.close();},300)}<\/script>` +
        `</body></html>`
      );
      pw.document.close();
    };

    tryPrint();
  };

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col p-0">
        {/* ── Header: title + size selector + print button ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b print:hidden">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {t("Imprimer étiquettes", "طباعة الملصقات")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs">{t("Taille", "الحجم")}</Label>
              <Select value={size} onValueChange={(v) => setSize(v as LabelSize)}>
                <SelectTrigger className="h-8 text-xs w-44" data-testid="select-label-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xsmall">{t("Très Petit (30×20mm)", "صغير جداً (30×20مم)")}</SelectItem>
                  <SelectItem value="small">{t("Petit (40×25mm)", "صغير (40×25مم)")}</SelectItem>
                  <SelectItem value="medium">{t("Moyen (60×35mm)", "متوسط (60×35مم)")}</SelectItem>
                  <SelectItem value="large">{t("Grand (80×50mm)", "كبير (80×50مم)")}</SelectItem>
                  <SelectItem value="xlarge">{t("Très Grand (100×60mm)", "كبير جداً (100×60مم)")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="bg-[#1B3057] hover:bg-[#1B3057]/90"
              onClick={handlePrint}
              data-testid="button-print-labels"
            >
              <Printer className="h-4 w-4 mr-1" /> {t("Imprimer", "طباعة")}
            </Button>
          </div>
        </div>

        {/* ── Display options ── */}
        <div className="px-5 py-2.5 border-b print:hidden bg-muted/10 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-xs font-semibold text-muted-foreground shrink-0">
            {t("Afficher", "إظهار")}
          </span>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Switch
              checked={showPrice}
              onCheckedChange={setShowPrice}
              disabled={priceOnly}
              data-testid="toggle-show-price"
            />
            <span className={`text-xs ${priceOnly ? "text-muted-foreground/50" : ""}`}>{t("Prix", "السعر")}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Switch
              checked={showReference}
              onCheckedChange={setShowReference}
              disabled={priceOnly}
              data-testid="toggle-show-reference"
            />
            <span className={`text-xs ${priceOnly ? "text-muted-foreground/50" : ""}`}>{t("Réf.", "المرجع")}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Switch
              checked={showStoreName}
              onCheckedChange={setShowStoreName}
              data-testid="toggle-show-store"
            />
            <span className="text-xs">{t("Boutique", "المتجر")}</span>
          </label>
          <div className="h-4 w-px bg-border shrink-0" />
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <Switch
              checked={priceOnly}
              onCheckedChange={setPriceOnly}
              data-testid="toggle-price-only"
            />
            <span className="text-xs font-semibold">{t("Prix uniquement", "السعر فقط")}</span>
          </label>
        </div>

        {/* ── Barcode size controls ── */}
        {!priceOnly && (
          <div className="px-5 py-2.5 border-b print:hidden bg-muted/5 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs font-semibold text-muted-foreground shrink-0">
              {t("Code-barres", "الباركود")}
            </span>
            <div className="flex items-center gap-2">
              <Label className="text-xs shrink-0 text-muted-foreground">{t("Hauteur du code", "ارتفاع الكود")}</Label>
              <input
                type="range"
                min={20} max={120} step={1}
                value={barHeightOverride}
                onChange={(e) => setBarHeightOverride(Number(e.target.value))}
                className="w-28 accent-[#1B3057] cursor-pointer"
              />
              <span className="text-xs font-mono w-7 text-right">{barHeightOverride}</span>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs shrink-0 text-muted-foreground">{t("Taille du code", "حجم الكود")}</Label>
              <input
                type="range"
                min={6} max={18} step={1}
                value={barFontOverride}
                onChange={(e) => setBarFontOverride(Number(e.target.value))}
                className="w-28 accent-[#1B3057] cursor-pointer"
              />
              <span className="text-xs font-mono w-7 text-right">{barFontOverride}</span>
            </div>
          </div>
        )}

        {/* ── Quantities per product ── */}
        <div className="px-5 py-3 border-b print:hidden bg-muted/20">
          <Label className="text-xs mb-2 block font-semibold">{t("Quantité par article", "الكمية لكل منتج")}</Label>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {rows.map((r, i) => (
              <div key={r.product.id + "-" + i} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">
                  <span className="font-medium">{r.product.nameEn}</span>
                  <span className="text-xs text-muted-foreground ml-2 font-mono">{r.product.barcode}</span>
                </span>
                <Input
                  type="number" min={1} value={r.qty}
                  onChange={(e) => setQty(i, parseInt(e.target.value) || 1)}
                  className="h-7 w-20 text-sm"
                  data-testid={`input-label-qty-${i}`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* ── Label preview / print area ── */}
        <div className="flex-1 overflow-y-auto p-4 bg-white" id="midanic-print-area">
          <div
            className="grid gap-2 print:gap-1"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${dims.w}, 1fr))`,
            }}
          >
            {allLabels.map((p, idx) => (
              <div
                key={idx}
                className="border border-gray-300 rounded p-1 flex flex-col items-center text-center bg-white"
                style={{ width: dims.w, height: dims.h, breakInside: "avoid" }}
              >
                {priceOnly ? (
                  /* ── Price-only layout ── */
                  <>
                    {showStoreName && (
                      <div className="text-[8px] text-muted-foreground leading-none mb-0.5 font-medium tracking-wide uppercase w-full truncate">
                        {getStoreName()}
                      </div>
                    )}
                    <div
                      className="font-semibold leading-tight truncate w-full"
                      style={{ fontSize: dims.name }}
                      title={p.nameEn}
                    >
                      {p.nameEn}
                    </div>
                    <div className="flex-1 flex items-center justify-center w-full">
                      <div
                        className="font-black leading-none"
                        style={{ fontSize: `calc(${dims.name} * 2.2)` }}
                      >
                        {p.price
                          ? `${parseFloat(p.price).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} ${currency}`
                          : "—"}
                      </div>
                    </div>
                  </>
                ) : (
                  /* ── Standard layout ── */
                  <>
                    {showStoreName && (
                      <div className="text-[8px] text-muted-foreground leading-none mb-0.5 font-medium tracking-wide uppercase w-full truncate">
                        {getStoreName()}
                      </div>
                    )}
                    <div
                      className="font-semibold leading-tight truncate w-full"
                      style={{ fontSize: dims.name }}
                      title={p.nameEn}
                    >
                      {p.nameEn}
                    </div>
                    {showPrice && p.price && (
                      <div className="font-bold leading-tight" style={{ fontSize: dims.name }}>
                        {parseFloat(p.price).toLocaleString("fr-DZ", { minimumFractionDigits: 2 })} {currency}
                      </div>
                    )}
                    <div className="mt-auto">
                      {p.barcode ? (
                        <BarcodeSvg
                          value={p.barcode}
                          height={barHeightOverride}
                          width={dims.barW}
                          fontSize={barFontOverride}
                          margin={dims.barMargin}
                        />
                      ) : (
                        <div className="text-[8px] text-muted-foreground text-center py-1 font-mono">
                          {t("Pas de code-barres", "لا باركود")}
                        </div>
                      )}
                    </div>
                    {showReference && p.reference && (
                      <div className="text-[8px] text-muted-foreground font-mono leading-none">
                        {p.reference}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
