"use client";
// ภาษาที่เลือกเก็บในเบราว์เซอร์ (เก็บไม่ได้ก็ใช้ภาษาเริ่มต้น) หน้าจอที่ไม่อยู่ใต้ Provider ใช้ภาษาเริ่มต้น
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, isLocale, translate, type Locale } from "./index";
import type { Msg, MsgKey, Params } from "./msg";

const KEY = "vanguard.locale";

const I18n = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({ locale: DEFAULT_LOCALE, setLocale: () => {} });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  // อ่านหลังโหลดหน้า ค่าที่ render จาก server จะได้ไม่ขัดกับฝั่งเบราว์เซอร์
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (isLocale(saved)) setLocaleState(saved);
    } catch {
      // อ่านไม่ได้ก็ใช้ภาษาเริ่มต้น
    }
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  function setLocale(l: Locale) {
    setLocaleState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      // เก็บไม่ได้ก็ใช้ต่อในรอบนี้
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
