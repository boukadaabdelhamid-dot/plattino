import { useLang } from "@/hooks/use-lang";
import { ShoppingCart } from "lucide-react";
import Pos from "./Pos";

export default function Orders() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-6 w-6 text-[#1B3057]" />
          {t("Vente rapide", "بيع سريع")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("Point de vente", "نقطة البيع")}
        </p>
      </div>
      <Pos />
    </div>
  );
}
