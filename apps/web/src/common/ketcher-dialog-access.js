import { watch } from "vue";
import { uiText, useUiLanguage } from "@/i18n";

export function bindKetcherDialogAccess(doc) {
  if (!doc?.body || typeof doc.querySelectorAll !== "function") return () => {};
  const labels = new WeakMap(), { locale } = useUiLanguage();
  function apply() {
    for (const button of doc.querySelectorAll('button[class*="Dialog-module_buttonTop"]')) {
      const previous = labels.get(button);
      if ((!button.hasAttribute("aria-label") && !button.hasAttribute("title"))
        || previous !== undefined && button.getAttribute("aria-label") === previous) {
        const label = uiText("关闭");
        if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
        labels.set(button, label);
      }
    }
  }
  const Observer = doc.defaultView?.MutationObserver || MutationObserver;
  const observer = new Observer(records => {
    // Molecular SVG repainting is not a dialog lifecycle change.
    if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1
      && node.namespaceURI === "http://www.w3.org/1999/xhtml"))) apply();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  const stop = watch(locale, apply, { flush: "sync" });
  apply();
  return () => { observer.disconnect(); stop(); };
}
