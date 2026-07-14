import React, { createContext, useContext, useEffect, useState } from "react";
import { I18nManager } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ErpLang = "fr" | "ar";

type LangContextType = {
  lang: ErpLang;
  setLang: (lang: ErpLang) => void;
  isRTL: boolean;
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
      if (saved === "ar" || saved === "fr") setLangState(saved);
      setReady(true);
    })();
  }, []);

  const setLang = (next: ErpLang) => {
    setLangState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
    // Note: full RTL layout mirroring requires I18nManager.forceRTL + app
    // reload on native. We flip text alignment/content direction through the
    // `isRTL` flag instead so language can change without restarting.
  };

  const value: LangContextType = {
    lang,
    setLang,
    isRTL: lang === "ar",
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

// Referenced so bundlers keep I18nManager import intentional if we later
// enable forced RTL layout for the ar experience.
void I18nManager;
