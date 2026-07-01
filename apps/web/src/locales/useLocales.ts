import { useTranslation } from "react-i18next";
import { setLanguage, type Lang } from "./i18n";

/** One hook every component uses for translation + language switching. */
export function useLocales() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  return {
    t,
    lang,
    isRTL: lang === "ar",
    setLanguage,
    toggle: () => setLanguage(lang === "en" ? "ar" : "en"),
  };
}
