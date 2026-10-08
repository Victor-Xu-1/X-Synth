import { computed, readonly, ref } from "vue";
import { createI18n } from "vue-i18n";
import { messages } from "./catalog";

export const LOCALE_KEY = "x-synth.locale";
export const LOCALES = Object.freeze([
  { value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" },
]);
const supported = new Set(LOCALES.map((item) => item.value));

export const i18n = createI18n({
  legacy: false, globalInjection: false, locale: "zh-CN", fallbackLocale: "zh-CN",
  messages,
  messageResolver: (catalog, key) => Object.hasOwn(catalog, key) ? catalog[key] : null,
  missingWarn: false, fallbackWarn: false,
});

const preferenceError = ref("");
let browser = null, storageListener = null;

export function uiText(source, parameters = {}) {
  if (typeof source !== "string" || !i18n.global.te(source)) return source;
  return i18n.global.t(source, parameters);
}

export function setLocale(value, { persist = true } = {}) {
  if (!supported.has(value)) throw new RangeError("Unsupported UI locale");
  i18n.global.locale.value = value;
  if (browser?.document) browser.document.documentElement.lang = value;
  preferenceError.value = "";
  if (!persist || !browser) return;
  try { browser.localStorage.setItem(LOCALE_KEY, value); }
  catch { preferenceError.value = "语言偏好未能保存；当前页面仍使用所选语言。"; }
}

export function initializeLocale(target = typeof window === "undefined" ? null : window) {
  if (browser && storageListener) browser.removeEventListener("storage", storageListener);
  browser = target;
  let saved = "zh-CN";
  try {
    const value = browser?.localStorage.getItem(LOCALE_KEY);
    if (supported.has(value)) saved = value;
  } catch { /* A denied preference store must not block the chemical workspace. */ }
  setLocale(saved, { persist: false });
  if (!browser) return;
  storageListener = (event) => {
    if (event.key !== LOCALE_KEY && event.key !== null) return;
    if (event.key === null || event.newValue === null) setLocale("zh-CN", { persist: false });
    else if (supported.has(event.newValue)) setLocale(event.newValue, { persist: false });
  };
  browser.addEventListener("storage", storageListener);
}

export function useUiLanguage() {
  return { locale: readonly(i18n.global.locale), locales: LOCALES, setLocale,
    widgetLocale: computed(() => i18n.global.locale.value === "en" ? "en" : "zhHans"),
    preferenceError: computed(() => uiText(preferenceError.value)) };
}

export function formatUiDate(value, options = { hour12: false }) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? uiText("未提供") : date.toLocaleString(i18n.global.locale.value, options);
}

export default { install(app) { app.use(i18n); app.config.globalProperties.$tr = uiText; } };
