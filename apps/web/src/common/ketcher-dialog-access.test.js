import { bindKetcherDialogAccess } from "./ketcher-dialog-access";
import { initializeLocale, setLocale } from "@/i18n";
import { nextTick } from "vue";

test("native close controls get the shared language name without changing dialog content or vendor labels", async () => {
  initializeLocale(null);
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = '<section role="dialog"><p>Original chemistry</p><button class="Dialog-module_buttonTop__pinned"><svg /></button><button class="Dialog-module_buttonTop__vendor" aria-label="Vendor-owned close" /></section>';
  const release = bindKetcherDialogAccess(doc);
  const buttons = doc.querySelectorAll("button");
  expect(buttons[0].getAttribute("aria-label")).toBe("Close");
  expect(buttons[1].getAttribute("aria-label")).toBe("Vendor-owned close");
  setLocale("zh-CN", { persist: false }); await nextTick();
  expect(buttons[0].getAttribute("aria-label")).toBe("关闭");
  expect(doc.querySelector("p").textContent).toBe("Original chemistry");
  const added = doc.createElement("button"); added.className = "Dialog-module_buttonTop__later"; doc.body.append(added);
  await nextTick(); await Promise.resolve();
  expect(added.getAttribute("aria-label")).toBe("关闭");
  release(); setLocale("en", { persist: false }); await nextTick();
  expect(buttons[0].getAttribute("aria-label")).toBe("关闭");
  const retired = doc.createElement("button"); retired.className = added.className; doc.body.append(retired);
  await nextTick(); await Promise.resolve();
  expect(retired.hasAttribute("aria-label")).toBe(false);
});

test("incomplete native document protocols add no observer or global authority", () => {
  expect(() => bindKetcherDialogAccess(null)()).not.toThrow();
  expect(() => bindKetcherDialogAccess({ defaultView: new EventTarget() })()).not.toThrow();
});
