import React, { createContext, useContext, useEffect, useState } from "react";
import { I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ErpLang = "fr" | "ar";

type LangContextType = {
  lang: ErpLang;
  /**
   * Switch the interface language. Native layout direction (RTL) is a
   * process-level flag (`I18nManager`) that only takes effect after a JS
   * reload, so this persists the choice and applies `forceRTL` immediately,
   * but the mirrored layout only shows up once the app reloads — callers
   * that want to prompt the user for that reload should use
   * `setLangAndReload` instead (see `app/(app)/settings/languages.tsx`).
   */
  setLang: (lang: ErpLang) => void;
  isRTL: boolean;
  /** True once forceRTL has been applied for `lang` but the app has not
   * reloaded yet, so the native layout doesn't match `isRTL` on screen. */
  pendingRestart: boolean;
  /** Translate helper: t(frText, arText) */
  t: (fr: string, ar: string) => string;
  ready: boolean;
};

const STORAGE_KEY = "midanic_erp_lang";

const LangContext = createContext<LangContextType | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<ErpLang>("fr");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      const resolved = saved === "ar" || saved === "fr" ? saved : "fr";
      setLangState(resolved);
      // Bring the native RTL flag in sync with the persisted language on
      // launch (this is a no-op if a previous reload already applied it).
      applyForceRTL(resolved);
      setReady(true);
    })();
  }, []);

  const setLang = (next: ErpLang) => {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
    applyForceRTL(next);
  };

  const value: LangContextType = {
    lang,
    setLang,
    isRTL: lang === "ar",
    pendingRestart: (lang === "ar") !== I18nManager.isRTL,
    t: (fr, ar) => (lang === "ar" ? ar : fr),
    ready,
  };

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextType {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}

/**
 * Flip the native RTL layout flag to match `lang`. `I18nManager.forceRTL`
 * only affects layout after the JS bundle reloads — the caller is
 * responsible for triggering that reload (see `settings/languages.tsx`,
 * which prompts the user and calls `DevSettings.reload()`).
 */
function applyForceRTL(lang: ErpLang) {
  const shouldBeRTL = lang === "ar";
  if (I18nManager.isRTL !== shouldBeRTL) {
    I18nManager.allowRTL(shouldBeRTL);
    I18nManager.forceRTL(shouldBeRTL);
  }
}
