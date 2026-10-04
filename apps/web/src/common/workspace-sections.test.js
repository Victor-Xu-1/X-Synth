import {
  activeNavigation,
  navigation,
  sectionNavigation,
  navigationLocation,
} from "./workspace-navigation";
const selected = (route) =>
  navigation
    .flatMap((group) => group.items)
    .filter((item) => activeNavigation(item, route));
test("the sidebar has three work entries and one environment entry", () => {
  expect(
    navigation.flatMap((group) => group.items).map((item) => item.title),
  ).toEqual(["路线设计", "任务与路线", "研究工具", "环境部署"]);
});
test.each(["auto", "manual", "import"])(
  "all workbench modes stay under route design: %s",
  (mode) => {
    expect(
      selected({ path: "/", query: { mode } }).map((item) => item.title),
    ).toEqual(["路线设计"]);
  },
);
test.each(["/results", "/results/123", "/documents", "/editor", "/editor/123"])(
  "tasks and editable copies remain one navigation family: %s",
  (path) => {
    expect(selected({ path, query: {} }).map((item) => item.title)).toEqual([
      "任务与路线",
    ]);
  },
);
test.each([
  "/buyables",
  "/feasibility",
  "/molcom",
  "/drawing",
  "/template",
  "/forward",
  "/solprop",
  "/qm",
])("a tool has one sidebar entry: %s", (path) => {
  expect(selected({ path, query: {} }).map((item) => item.title)).toEqual([
    "研究工具",
  ]);
});
test("route detail and editor keep the immersive canvas without an extra tab strip", () => {
  for (const path of ["/results/123", "/editor", "/editor/123"])
    expect(sectionNavigation({ path, query: {} }, {})).toBeNull();
  const section = sectionNavigation({ path: "/documents", query: {} }, {});
  expect(section.items.map((item) => item.title)).toEqual([
    "任务记录",
    "保存的路线",
  ]);
});
test("tools require real capabilities; drawing/template are secondary without a second sidebar", () => {
  const features = {
    stock: true,
    fast_filter: true,
    scscore: true,
    drawing: true,
    templates: true,
  };
  const section = sectionNavigation({ path: "/buyables", query: {} }, features);
  expect(section.items.map((item) => item.title)).toEqual([
    "原料检索",
    "反应评估",
    "结构评估",
  ]);
  expect(section.more.map((item) => item.title)).toEqual([
    "结构绘制",
    "模板检索",
  ]);
  expect(
    sectionNavigation({ path: "/buyables", query: {} }, { stock: true }).more,
  ).toEqual([]);
  expect(sectionNavigation({ path: "/buyables", query: {} }, {}).items).toEqual(
    [],
  );
});
test("environment controls are separate and feature-gated", () => {
  expect(
    selected({ path: "/environments", query: {} }).map((item) => item.title),
  ).toEqual(["环境部署"]);
  expect(
    selected({ path: "/admin", query: {} }).map((item) => item.title),
  ).toEqual(["环境部署"]);
  expect(
    sectionNavigation({ path: "/environments", query: {} }, {}),
  ).toBeNull();
  expect(
    sectionNavigation(
      { path: "/admin", query: {} },
      { administrator: true },
    ).items.map((item) => item.title),
  ).toEqual(["环境部署", "用户与权限"]);
});
test("available native submodules use their existing workbench, not repeated outer tabs", () => {
  const section = sectionNavigation(
    { path: "/forward", query: { tab: "impurity" } },
    { conditions: true, forward: true, impurity: true, solubility: true },
  );
  expect(section.more.map((item) => item.title)).toEqual([
    "合成与反应条件",
    "溶解度与溶剂",
  ]);
  expect(section.more[0].to).toBe("/forward?tab=impurity");
  expect(
    activeNavigation(section.more[0], {
      path: "/forward",
      query: { tab: "selectivity" },
    }),
  ).toBe(true);
});
test("group navigation returns to the correct collection and does not reset a current tool", () => {
  const library = navigation[0].items[1],
    tools = navigation[0].items[2];
  expect(
    navigationLocation(library, { path: "/editor/123", query: {} }, {}),
  ).toBe("/documents");
  const current = {
    path: "/feasibility",
    query: { reactants: "CCO", product: "CC=O" },
  };
  expect(navigationLocation(tools, current, {})).toEqual({
    path: current.path,
    query: current.query,
  });
  expect(
    navigationLocation(tools, { path: "/", query: {} }, { scscore: true }),
  ).toBe("/molcom");
});
