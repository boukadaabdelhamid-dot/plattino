import { BellRing } from "lucide-react";
import { useLang } from "@/hooks/use-lang";

export default function SettingsNotifications() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <BellRing className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">{t("Notifications", "الإشعارات")}</h1>
          <p className="text-sm text-muted-foreground">{t("Préférences de notification", "تفضيلات الإشعارات")}</p>
        </div>
      </div>
      <div className="rounded-lg border bg-muted/30 p-8 text-center text-muted-foreground">
        <p className="text-sm">{t("Cette section sera disponible prochainement.", "هذا القسم سيكون متاحًا قريبًا.")}</p>
      </div>
    </div>
  );
}
