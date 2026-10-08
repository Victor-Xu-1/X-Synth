/** @jest-environment node */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compileScript,
  compileStyle,
  compileTemplate,
  parse,
} from "@vue/compiler-sfc";

const source = (file) =>
  readFileSync(resolve(__dirname, "../..", file), "utf8");

function elements(node) {
  return [node, ...(node.children || []).flatMap(elements)];
}
const bound = (node, name) => node.props.find(prop => prop.type === 7 && prop.name === "bind" && prop.arg?.content === name)?.exp?.content;

test("environment tabs control persistent named panels rather than unrelated sections", () => {
  const { descriptor } = parse(source("views/environments/EnvironmentDeployment.vue"));
  const nodes = elements(descriptor.template.ast);
  const tab = nodes.find(node => node.tag === "v-tab");
  const panel = nodes.find(node => node.props?.some(prop => prop.name === "role" && prop.value?.content === "tabpanel"));
  expect(panel).toBeDefined();
  expect(bound(tab, "id")).toBe(bound(panel, "aria-labelledby"));
  expect(bound(tab, "aria-controls")).toBe(bound(panel, "id"));
  expect(bound(panel, "hidden")).toBe("tab !== view.value");
  expect(bound(tab, "id")).toContain("viewId");
});

test("unread inventory health is not labelled as a failed consistency check", () => {
  const page = source("views/environments/EnvironmentDeployment.vue");
  expect(page).toMatch(/inventory_consistent === false/);
});

test.each([
  "views/environments/EnvironmentDeployment.vue",
  "components/environments/EngineEnvironment.vue",
  "components/environments/EnvironmentMonitoring.vue",
])("%s compiles against the real Vue compiler", (filename) => {
  const { descriptor, errors } = parse(source(filename), { filename });
  expect(errors).toEqual([]);
  const script = compileScript(descriptor, { id: "environment" });
  expect(
    compileTemplate({
      filename,
      id: "environment",
      source: descriptor.template.content,
      compilerOptions: { bindingMetadata: script.bindings },
    }).errors,
  ).toEqual([]);
  for (const style of descriptor.styles)
    expect(
      compileStyle({
        filename,
        id: "data-v-environment",
        source: style.content,
        scoped: style.scoped,
      }).errors,
    ).toEqual([]);
});

test("environment sections use API inventory, URL tabs and cleanup, not browser shell controls", () => {
  const page = source("views/environments/EnvironmentDeployment.vue");
  for (const label of ["引擎环境", "部署配置", "运行监测"])
    expect(page).toContain(label);
  expect(page).toContain("loadRuntimeStatus(API)");
  expect(page).toContain("snapshot.environments.engines");
  expect(page).toContain("route.query.tab");
  expect(page).toContain("onBeforeUnmount");
  expect(page).toContain("if (!alive) return;");
  expect(page).not.toMatch(/API\.(?:post|put|delete)\(/);
  expect(page).not.toContain("setInterval");
  expect(page).not.toContain("ASKCOS V2");
});

test("prominent workspace templates stay backend-neutral while environment cards retain actual engine names", () => {
  for (const filename of [
    "components/workspace/RouteSearchSettings.vue",
    "components/workspace/OneStepSettings.vue",
    "components/workspace/TaskCard.vue",
    "components/routes/RoutePreview.vue",
    "views/workspace/Calculator.vue",
  ]) {
    const { descriptor } = parse(source(filename));
    expect(descriptor.template.content).not.toContain("ASKCOS");
  }
  expect(source("components/environments/EngineEnvironment.vue")).toContain(
    "engine.name",
  );
  expect(source("components/workspace/TaskCard.vue")).toContain(
    "taskSourceLabel(props.task)",
  );
  expect(source("components/routes/RoutePreview.vue")).toContain(
    "<RouteReader",
  );
  expect(source("components/routes/RouteStepList.vue")).toContain(
    "engineUiLabel",
  );
  expect(source("components/routes/route-ui-text.js")).toContain("engineLabel(engine)");
});

test("legacy status redirects without a competing page and shell links enter the environment module", () => {
  const router = source("router/index.js");
  expect(router).toContain('path: "environments"');
  expect(router).toContain('path: "/environments"');
  expect(router).toContain('tab: "monitor"');
  expect(router).not.toContain("views/status/Status.vue");
  expect(existsSync(resolve(__dirname, "../status/Status.vue"))).toBe(false);
  expect(source("layouts/default/AppBar.vue")).toContain("/environments");
  expect(source("layouts/default/Sidebar.vue")).toContain("footerItems");
  expect(source("common/workspace-navigation.js")).toContain(
    'placement: "footer"',
  );
  expect(source("common/workspace-navigation.js")).toContain(
    'to: "/environments"',
  );
});
