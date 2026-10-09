import routes from "./catalog-routes";
import common from "./catalog-common";
import system from "./catalog-system";
import { buildCatalog } from "./catalog";
import { DEFAULT_LOCALE, initializeLocale, setLocale, uiText } from "./index";

const parameters = (phrase) => [...new Set([...phrase.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))].sort();

test("route catalog shares the glossary and preserves every named parameter", () => {
  expect(() => buildCatalog([common, system, routes])).not.toThrow();
  for (const [source, english] of routes) {
    expect(source.trim()).not.toBe("");
    expect(english.trim()).not.toBe("");
    expect(parameters(english)).toEqual(parameters(source));
  }
});

test("fresh English, explicit Chinese and unknown source use the single reactive complete-phrase pipeline", () => {
  initializeLocale(null);
  expect(DEFAULT_LOCALE).toBe("en");
  expect(uiText("永久删除“{name}”？此操作不可撤销。", { name: "取消 / 我的路线" }))
    .toBe("Permanently delete “取消 / 我的路线”? This cannot be undone.");
  expect(uiText("{matched}/{total} 步核验匹配", { matched: 0, total: 3 })).toBe("0/3 steps matched in verification");
  expect(uiText("未收录的原始资料")).toBe("未收录的原始资料");
  setLocale("zh-CN", { persist: false });
  expect(uiText("永久删除“{name}”？此操作不可撤销。", { name: "取消 / 我的路线" }))
    .toBe("永久删除“取消 / 我的路线”？此操作不可撤销。");
  expect(uiText("{matched}/{total} 步核验匹配", { matched: 0, total: 3 })).toBe("0/3 步核验匹配");
});

test("application-owned document conflicts and unapplied edits use complete bilingual resources", () => {
  initializeLocale(null);
  expect(uiText("文档已被其他页面修改，请重新载入或另存副本。"))
    .toBe("This document was changed in another page. Reload it or save a copy.");
  expect(uiText("未应用修改")).toBe("Unapplied changes");
  expect(uiText("重新载入文档")).toBe("Reload document");
  setLocale("zh-CN", { persist: false });
  expect(uiText("未应用修改")).toBe("未应用修改");
  expect(uiText("TEST ONLY 原文标签")).toBe("TEST ONLY 原文标签");
});
