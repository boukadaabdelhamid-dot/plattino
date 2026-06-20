import { User } from "lucide-react";
import { useLang } from "@/hooks/use-lang";

export default function SettingsProfile() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <User className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">{t("Profil boutique", "ملف المتجر")}</h1>
          <p className="text-sm text-muted-foreground">{t("Informations générales de la boutique", "معلومات المتجر العامة")}</p>
        </div>
      </div>
      <div className="rounded-lg border bg-muted/30 p-8 text-center text-muted-foreground">
        <p className="text-sm">{t("Cette section sera disponible prochainement.", "هذا القسم سيكون متاحًا قريبًا.")}</p>
      </div>
    </div>
  );
}
