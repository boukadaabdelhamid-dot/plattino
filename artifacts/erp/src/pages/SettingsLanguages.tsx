import { Languages, Check } from "lucide-react";
import { useLang, type ErpLang } from "@/hooks/use-lang";
import { cn } from "@/lib/utils";

const LANGS: { value: ErpLang; label: string; sublabel: string; flag: string; dir: "ltr" | "rtl" }[] = [
  { value: "fr", label: "Français", sublabel: "Interface en français", flag: "🇫🇷", dir: "ltr" },
  { value: "ar", label: "العربية", sublabel: "الواجهة بالعربية", flag: "🇩🇿", dir: "rtl" },
];

export default function SettingsLanguages() {
  const { lang, setLang } = useLang();

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Languages className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">
            {lang === "ar" ? "اللغات" : "Langues"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {lang === "ar"
              ? "اختر لغة الواجهة"
              : "Choisissez la langue de l'interface"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {LANGS.map(({ value, label, sublabel, flag, dir }) => {
          const active = lang === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setLang(value)}
              className={cn(
                "relative flex items-center gap-4 rounded-xl border-2 p-5 text-left transition-all",
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border hover:border-primary/40 hover:bg-muted/40"
              )}
            >
              <span className="text-3xl">{flag}</span>
              <div className="flex-1 min-w-0" dir={dir}>
                <div className="font-semibold text-base leading-tight">{label}</div>
                <div className="text-sm text-muted-foreground mt-0.5">{sublabel}</div>
              </div>
              {active && (
                <div className="shrink-0 h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                  <Check className="h-3.5 w-3.5 text-primary-foreground" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        {lang === "ar"
          ? "يتم حفظ اللغة المختارة تلقائياً وتطبيقها على كامل الواجهة."
          : "La langue choisie est sauvegardée automatiquement et appliquée à toute l'interface."}
      </p>
    </div>
  );
}
