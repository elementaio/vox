import { createContext, useContext, useState, type ReactNode } from "react";
import { I18nManager } from "react-native";
import { kv } from "./adapters";

/**
 * Dual-language core: English + Arabic (RTL). Every user-facing string lives here,
 * so screens stay text-free and translation is one place. `setLang("ar")` also
 * flips layout direction via I18nManager (takes full effect after an app reload).
 */

export type Lang = "en" | "ar";
const LANG_KEY = "chat.lang.v1";

const en = {
  tagline: "Your mail, not their archive.",
  signedInAs: "Signed in as",
  createAccount: "Create a new account",
  accountHint: "An account is a key on this device — no email, no phone number.",
  recoveryLabel: "Your 12-word recovery phrase — write it down:",
  passphraseLabel: "Set a passphrase to encrypt it on this device:",
  passphrase: "passphrase",
  encryptContinue: "Encrypt & continue",
  unlockTitle: "Unlock your account",
  wrongPassphrase: "Wrong passphrase.",
  unlock: "Unlock",
  resetAccount: "Reset account",
  connectRelay: "Connect to a relay",
  relayHint: "Enter your Pochta server — the one your family, company, or provider runs.",
  relayPlaceholder: "chat.myfamily.com",
  connect: "Connect",
  signOut: "Sign out",
  addContactPlaceholder: "Paste an invite code to add a contact",
  add: "Add",
  noContacts: "No contacts yet. Add one with an invite code.",
  message: "Message",
  send: "Send",
  back: "Back",
  connecting: "connecting…",
  deleted: "deleted",
  toggleLang: "العربية",
};

type Dict = typeof en;
export type Key = keyof Dict;

const ar: Dict = {
  tagline: "بريدُك، لا أرشيفهم.",
  signedInAs: "مسجّل الدخول باسم",
  createAccount: "إنشاء حساب جديد",
  accountHint: "الحساب هو مفتاح على هذا الجهاز — بلا بريد إلكتروني أو رقم هاتف.",
  recoveryLabel: "عبارة الاسترداد المكوَّنة من ١٢ كلمة — اكتبها في مكان آمن:",
  passphraseLabel: "اختر عبارة مرور لتشفيرها على هذا الجهاز:",
  passphrase: "عبارة المرور",
  encryptContinue: "تشفير ومتابعة",
  unlockTitle: "افتح حسابك",
  wrongPassphrase: "عبارة المرور غير صحيحة.",
  unlock: "فتح",
  resetAccount: "إعادة تعيين الحساب",
  connectRelay: "الاتصال بالخادم",
  relayHint: "أدخل خادم بوتشتا الخاص بك — الذي تُشغّله عائلتك أو شركتك أو المزوّد.",
  relayPlaceholder: "chat.myfamily.com",
  connect: "اتصال",
  signOut: "تسجيل الخروج",
  addContactPlaceholder: "الصق رمز الدعوة لإضافة جهة اتصال",
  add: "إضافة",
  noContacts: "لا توجد جهات اتصال بعد. أضف واحدة عبر رمز الدعوة.",
  message: "رسالة",
  send: "إرسال",
  back: "رجوع",
  connecting: "جارٍ الاتصال…",
  deleted: "محذوفة",
  toggleLang: "English",
};

const dicts: Record<Lang, Dict> = { en, ar };

interface I18n {
  lang: Lang;
  isRTL: boolean;
  t: (key: Key) => string;
  toggle: () => void;
}

const Ctx = createContext<I18n | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>((kv.getItem(LANG_KEY) as Lang) || "en");

  const apply = (next: Lang) => {
    kv.setItem(LANG_KEY, next);
    I18nManager.forceRTL(next === "ar"); // full RTL flip applies on next app launch
    setLang(next);
  };

  const value: I18n = {
    lang,
    isRTL: lang === "ar",
    t: (key) => dicts[lang][key] ?? en[key],
    toggle: () => apply(lang === "en" ? "ar" : "en"),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside <LanguageProvider>");
  return ctx;
}
