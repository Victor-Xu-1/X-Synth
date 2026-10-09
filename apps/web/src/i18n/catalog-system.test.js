/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "@vue/compiler-sfc";
import { baseParse } from "@vue/compiler-dom";
import { parseExpression, parse as parseJs } from "@babel/parser";
import { buildCatalog, messages } from "./catalog";
import system from "./catalog-system";
import shell from "./catalog-system-shell";

const files = [
  "layouts/default/AppBar.vue", "layouts/default/Sidebar.vue", "layouts/default/Default.vue",
  "components/workspace/WorkspaceSectionNav.vue", "components/workspace/WorkspaceUpdateNotice.vue", "components/workspace/LanguageMenu.vue",
  "views/environments/EnvironmentDeployment.vue", "components/environments/EngineEnvironment.vue", "components/environments/EnvironmentMonitoring.vue", "components/environments/BackendInventory.vue",
  "views/login/AccountLoginForm.vue", "views/login/AuthHeader.vue", "views/login/AdminLogin.vue", "views/login/SSOLogin.vue", "views/login/SSOLogout.vue", "views/login/SSOCallback.vue",
  "views/admin/Admin.vue", "views/admin/AccountUserDialog.vue", "views/banlist/Banlist.vue", "views/notfound/NotFound.vue",
  "components/banlist/BanItemDialog.vue", "components/banlist/MultiEntryDialog.vue", "components/banlist/BanNotice.vue",
  "components/LocalizedConfirmActions.vue",
];
function walkJs(node, visit) {
  if (!node || typeof node !== "object") return;
  if (node.type) visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "comments", "extra"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(item => walkJs(item, visit));
    else if (value && typeof value === "object") walkJs(value, visit);
  }
}

test("system pairs are complete, deterministic and compatible with the published common glossary", () => {
  expect(() => buildCatalog([system])).not.toThrow();
  for (const [source, translation] of system) {
    expect(messages.en[source]).toBe(translation);
    expect(messages["zh-CN"][source]).toBe(source);
    expect(translation.trim()).not.toBe("");
  }
});

test("controlled core probe errors have English copy, not raw Chinese fallback", () => {
  expect(messages.en["无法连接工作区服务"]).toBe("Could not connect to the workspace service");
  expect(messages.en["无法确认工作区会话"]).toBe("Could not confirm the workspace session");
});

test("all router-controlled meta titles and account names have catalog entries without altering routes", () => {
  const source = readFileSync(resolve(__dirname, "../router/index.js"), "utf8");
  const titles = [];
  walkJs(parseJs(source, { sourceType: "module" }), node => {
    if (node.type === "ObjectProperty" && node.key?.name === "meta" && node.value.type === "ObjectExpression") {
      const title = node.value.properties.find((prop) => prop.key?.name === "title");
      if (title?.value.type === "StringLiteral") titles.push(title.value.value);
    }
    if (node.type === "CallExpression" && node.callee.name === "account" && node.arguments[1]?.type === "StringLiteral")
      titles.push(node.arguments[1].value);
  });
  expect(titles.length).toBeGreaterThan(20);
  const shellSources = new Set(shell.map(([phrase]) => phrase));
  expect(titles.filter((title) => !shellSources.has(title))).toEqual([]);
  for (const title of titles) expect(Object.hasOwn(messages.en, title)).toBe(true);
});

test.each(files)("%s has no untranslated static Chinese UI or uncatalogued template phrase", (relative) => {
  const { descriptor, errors } = parse(readFileSync(resolve(__dirname, "..", relative), "utf8"));
  expect(errors).toEqual([]);
  if (!descriptor.template) return;
  const ast = baseParse(descriptor.template.content), missing = [], raw = [];
  const check = (expression) => walkJs(parseExpression(expression), node => {
    if (node.type === "CallExpression" && node.callee.name === "$tr" && node.arguments[0]?.type === "StringLiteral" &&
      !Object.hasOwn(messages.en, node.arguments[0].value)) missing.push(node.arguments[0].value);
  });
  function walk(node) {
    if (node.type === 2 && /[\u3400-\u9fff]/.test(node.content)) raw.push(node.content.trim());
    if (node.type === 5) check(node.content.content);
    for (const prop of node.props || []) {
      if (prop.type === 6 && ["title", "label", "text", "aria-label", "placeholder", "no-data-text", "loading-text"].includes(prop.name) &&
        /[\u3400-\u9fff]/.test(prop.value?.content || "")) raw.push(prop.value.content);
      if (prop.type === 7 && prop.name === "bind" && prop.exp) check(prop.exp.content);
    }
    node.children?.forEach(walk);
  }
  walk(ast);
  expect(raw).toEqual([]); expect(missing).toEqual([]);
});
