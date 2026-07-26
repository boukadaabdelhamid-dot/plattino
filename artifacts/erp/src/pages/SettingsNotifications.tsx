import { useState, useEffect } from "react";
import { BellRing, Save, CalendarClock } from "lucide-react";
import { useLang } from "@/hooks/use-lang";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const LS_KEY = "midanic_expiry_settings";

type ExpirySettings = {
  enabled: boolean;
  days: number;
};

function loadSettings(): ExpirySettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { enabled: true, days: 30 };
    return JSON.parse(raw) as ExpirySettings;
  } catch {
    return { enabled: true, days: 30 };
  }
}

export default function SettingsNotifications() {
  const { lang } = useLang();
  const t = (fr: string, ar: string) => lang === "ar" ? ar : fr;
  const { toast } = useToast();

  const [settings, setSettings] = useState<ExpirySettings>(loadSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(false);
  }, [settings.enabled, settings.days]);

  const handleSave = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(settings));
      setSaved(true);
      toast({
        title: t("Paramètres sauvegardés", "تم الحفظ"),
        description: t("Les paramètres de péremption ont été mis à jour.", "تم تحديث إعدادات انتهاء الصلاحية."),
      });
    } catch {
      toast({
        variant: "destructive",
        title: t("Erreur", "خطأ"),
        description: t("Impossible de sauvegarder les paramètres.", "تعذّر حفظ الإعدادات."),
      });
    }
  };

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BellRing className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">{t("Notifications", "الإشعارات")}</h1>
          <p className="text-sm text-muted-foreground">{t("Préférences de notification", "تفضيلات الإشعارات")}</p>
        </div>
      </div>

      {/* Expiry settings card */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 px-5 py-4 border-b">
          <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
            <CalendarClock className="h-5 w-5 text-orange-600" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm">
              {t("Alerte dates de péremption", "تنبيه انتهاء الصلاحية")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                "Notifie quand des lots de produits approchent de leur date de péremption.",
                "يُنبّه عندما تقترب دفعات المنتجات من تاريخ انتهاء صلاحيتها."
              )}
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))}
          />
        </div>

        <div className={`px-5 py-4 space-y-4 transition-opacity ${settings.enabled ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
          <div className="flex items-center gap-4">
            <Label className="text-sm font-medium whitespace-nowrap">
              {t("Seuil d'alerte (jours avant expiration)", "حد التنبيه (أيام قبل انتهاء الصلاحية)")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={365}
                value={settings.days}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v > 0) setSettings((s) => ({ ...s, days: v }));
                }}
                className="h-8 w-24 text-sm text-center"
              />
              <span className="text-sm text-muted-foreground">{t("jours", "يوم")}</span>
            </div>
          </div>

          <div className="rounded-lg bg-muted/40 border px-4 py-3 text-xs text-muted-foreground space-y-1">
            <p>
              <span className="inline-block w-3 h-3 rounded-full bg-red-500 mr-1.5" />
              {t("Rouge : lot déjà expiré", "أحمر: دفعة منتهية الصلاحية")}
            </p>
            <p>
              <span className="inline-block w-3 h-3 rounded-full bg-orange-500 mr-1.5" />
              {t("Orange : expiration dans 0–7 jours", "برتقالي: تنتهي خلال 0–7 أيام")}
            </p>
            <p>
              <span className="inline-block w-3 h-3 rounded-full bg-yellow-400 mr-1.5" />
              {t(`Jaune : expiration dans 8–${settings.days} jours`, `أصفر: تنتهي خلال 8–${settings.days} يوماً`)}
            </p>
          </div>
        </div>

        <div className="px-5 py-3 border-t flex justify-end">
          <Button size="sm" onClick={handleSave} className="bg-[#1B3057] hover:bg-[#1B3057]/90">
            <Save className="h-4 w-4 mr-1.5" />
            {saved ? t("Sauvegardé ✓", "تم الحفظ ✓") : t("Sauvegarder", "حفظ")}
          </Button>
        </div>
      </div>
    </div>
  );
}
