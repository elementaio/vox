import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import ar from "./ar.json";

/** i18next setup for the web — English + Arabic, with RTL via `document.dir`. */

export type Lang = "en" | "ar";
const LANG_KEY = "chat.lang.v1";

const saved = localStorage.getItem(LANG_KEY) as Lang | null;
const device = navigator.language?.startsWith("ar") ? "ar" : "en";
const initial: Lang = saved ?? device;

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initial,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

applyDir(initial);

export function setLanguage(lang: Lang) {
  localStorage.setItem(LANG_KEY, lang);
  void i18n.changeLanguage(lang);
  applyDir(lang);
}

function applyDir(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

export default i18n;
