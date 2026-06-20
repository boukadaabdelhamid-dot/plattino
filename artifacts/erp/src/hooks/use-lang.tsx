import React, { createContext, useContext, useState, useEffect } from "react";

export type ErpLang = "fr" | "ar";

type LangContextType = {
  lang: ErpLang;
  setLang: (lang: ErpLang) => void;
};

const STORAGE_KEY = "midanic_erp_lang";

const LangContext = createContext<LangContextType | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<ErpLang>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved as ErpLang) || "fr";
  });

  const setLang = (next: ErpLang) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  };

  useEffect(() => {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextType {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}
