"use client";
// The chosen language is stored in the browser (if it can't be, the default language is used); screens outside the Provider use the default language
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, isLocale, translate, type Locale } from "./index";
import type { Msg, MsgKey, Params } from "./msg";

const KEY = "vanguard.locale";

const I18n = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({ locale: DEFAULT_LOCALE, setLocale: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  // Read after page load, so server-rendered values don't conflict with the browser
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (isLocale(saved)) setLocaleState(saved);
    } catch {
      // Can't read it: use the default language
    }
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  function setLocale(l: Locale) {
    setLocaleState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // Can't save it: keep using it for this session
    }
  }

  return <I18n.Provider value={{ locale, setLocale }}>{children}</I18n.Provider>;
}

export function useI18n() {
  const { locale, setLocale } = useContext(I18n);
  const t = (m: Msg | MsgKey, params?: Params) => translate(locale, m, params);
  return { locale, setLocale, t };
}

export const useT = () => useI18n().t;
