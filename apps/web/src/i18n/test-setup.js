import { config } from "@vue/test-utils";
import language, { initializeLocale, setLocale } from "./index";

config.global.plugins.push(language);
beforeEach(() => {
  initializeLocale(null);
  setLocale("zh-CN", { persist: false });
});
