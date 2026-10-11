import { baseCompile } from "@intlify/message-compiler";
import research from "./catalog-research";
import common from "./catalog-common";
import { buildCatalog } from "./catalog";
import { setLocale, uiText } from "./index";

function parameters(message) {
  const errors = [], names = new Set();
  const { ast } = baseCompile(message, { jit: true, onError: (error) => errors.push(error.message) });
  expect(errors).toEqual([]);
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === 4) names.add(`named:${node.key}`);
    if (node.type === 5) names.add(`list:${node.index}`);
    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    });
  }
  visit(ast);
  return [...names].sort();
}

test("research catalog shares the glossary, compiles in both languages and preserves every parameter", () => {
  expect(() => buildCatalog([common, research])).not.toThrow();
  for (const [source, english] of research) {
    expect(source.trim()).not.toBe("");
    expect(english.trim()).not.toBe("");
    expect(parameters(english)).toEqual(parameters(source));
  }
});

test("forward ranking and ledger labels stay concise and distinguish saved joint order in EN and CN", () => {
  setLocale("en", { persist: false });
  expect(uiText("模型排名")).toBe("Model rank");
  expect(uiText("联合排名")).toBe("Joint rank");
  expect(uiText("原生排名未记录；按已保存的联合顺序显示。")).toBe("Native rank not recorded; saved joint order.");
  expect(uiText("完整解码记录（{count} 条）", { count: 30 })).toBe("Complete decoder ledger (30)");
  expect(uiText("反应模型评分（FF）")).toBe("Reaction model score (FF)");
  setLocale("zh-CN", { persist: false });
  expect(uiText("模型排名")).toBe("模型排名");
  expect(uiText("完整解码记录（{count} 条）", { count: 30 })).toBe("完整解码记录（30 条）");
});

test("EOS termination and incomplete-decoding catalog labels use the shared EN and CN pipeline", () => {
  setLocale("en", { persist: false });
  expect(uiText("EOS 终止")).toBe("EOS termination");
  expect(uiText("解码 token 数（含 EOS）")).toBe("Decoded tokens (incl. EOS)");
  expect(uiText("未终止")).toBe("Unfinished");
  expect(uiText("解码未完成")).toBe("Incomplete decoding");
  setLocale("zh-CN", { persist: false });
  expect(uiText("解码未完成")).toBe("解码未完成");
  expect(uiText("未终止")).toBe("未终止");
});
