import { DevSettings, Platform } from "react-native";
import { useLang, type ErpLang } from "@/contexts/lang-context";
import { useConfirm } from "@/contexts/confirm-context";

/**
 * Shared language-switch behavior for every language toggle in the app
 * (login screen, drawer footer, settings). Persists the choice, then — since
 * native RTL layout mirroring only takes effect after a JS reload — asks the
 * user to restart and reloads if they agree.
 */
export function useLanguageSwitch() {
  const { lang, setLang } = useLang();
  const { confirm } = useConfirm();

  const selectLanguage = async (next: ErpLang) => {
    if (next === lang) return;
    setLang(next);

    const shouldReload = await confirm({
      title: "Redémarrer l'application ?",
      titleAr: "إعادة تشغيل التطبيق؟",
      message:
        "La mise en page doit être inversée pour l'arabe/le français. Redémarrer maintenant pour appliquer le changement.",
      messageAr: "يجب عكس تخطيط الواجهة للعربية/الفرنسية. أعد التشغيل الآن لتطبيق التغيير.",
      confirmLabel: "Redémarrer",
      confirmLabelAr: "إعادة التشغيل",
      cancelLabel: "Plus tard",
      cancelLabelAr: "لاحقاً",
    });

    if (!shouldReload) return;

    if (__DEV__ && typeof DevSettings?.reload === "function") {
      DevSettings.reload();
    } else if (Platform.OS === "web") {
      (globalThis as unknown as { location?: { reload: () => void } }).location?.reload();
    }
    // In a standalone production build there is no in-JS reload API; the
    // mirrored layout applies the next time the app is launched.
  };

  return { toggleLanguage: () => selectLanguage(lang === "ar" ? "fr" : "ar"), selectLanguage };
}
