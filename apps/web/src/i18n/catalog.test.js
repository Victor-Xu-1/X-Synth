import { baseCompile } from "@intlify/message-compiler";
import { messages } from "./catalog";
import { setLocale, uiText } from "./index";

function messageParameters(value) {
  const errors = [];
  const { ast } = baseCompile(value, { jit: true, onError: (error) => errors.push(error.message) });
  expect(errors).toEqual([]);
  const parameters = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === 4) parameters.push(`named:${node.key}`);
    if (node.type === 5) parameters.push(`list:${node.index}`);
    Object.values(node).forEach((value) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    });
  }
  visit(ast);
  return [...new Set(parameters)].sort();
}

test("every controlled message has both languages, valid syntax and the same parameter identity", () => {
  const chinese = Object.keys(messages["zh-CN"]).sort();
  expect(Object.keys(messages.en).sort()).toEqual(chinese);
  for (const source of chinese) {
    expect(typeof messages.en[source]).toBe("string");
    expect(messages.en[source].trim()).not.toBe("");
    expect(messageParameters(messages.en[source])).toEqual(messageParameters(messages["zh-CN"][source]));
  }
});

test("named chemical-data parameters retain zero, complete structures and user text rather than translating values", () => {
  setLocale("en", { persist: false });
  expect(uiText("产物 {count}", { count: 0 })).toBe("Products 0");
  const filename = "名称 [13C] 样品.sdf";
  expect(uiText("{filename} · {count} 条结构", { filename, count: 2 })).toBe(`${filename} · 2 structures`);
  expect(uiText("{filename} · {count} 条结构", { filename, count: 1 })).toBe(`${filename} · 1 structure`);
  expect(uiText("{filename} · {count} 条结构", { filename, count: 0 })).toBe(`${filename} · 0 structures`);
  const identity = "[13CH3][C@H]([NH3+])CO.[Cl-]";
  expect(uiText("放大{label}", { label: identity })).toBe(`Enlarge ${identity}`);
  setLocale("zh-CN", { persist: false });
  expect(uiText("产物 {count}", { count: 0 })).toBe("产物 0");
});
