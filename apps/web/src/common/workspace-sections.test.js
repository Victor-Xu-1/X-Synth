import {
  activeNavigation,
  navigation,
  visibleNavigation,
  sectionNavigation,
  navigationLocation,
  reactionWorkspaceRedirect,
} from "./workspace-navigation";
const selected = (route) =>
  navigation
    .flatMap((group) => group.items)
    .filter((item) => activeNavigation(item, route));
const entry = (id) =>
  navigation.flatMap((group) => group.items).find((item) => item.id === id);
const readyTools = {
  stock: true,
  fast_filter: true,
  scscore: true,
  drawing: true,
  templates: true,
};

test("legacy model links cannot silently execute a different scientific tool", () => {
  for (const tab of ["selectivity", "sites", "unsupported", ["context", "forward"]]) {
    expect(reactionWorkspaceRedirect({ path: "/forward", query: { tab } }).path).toBe("/environments");
  }
  expect(reactionWorkspaceRedirect({ path: "/forward", query: { reactants: "CCO" } })).toEqual({
    path: "/forward", query: { reactants: "CCO", tab: "context" }, replace: true,
  });
  expect(reactionWorkspaceRedirect({ path: "/forward", query: { tab: "impurity", reactants: "CCO" } })).toEqual({
    path: "/impurity", query: { reactants: "CCO" }, replace: true,
  });
  expect(reactionWorkspaceRedirect({ path: "/forward", query: { tab: "forward" } })).toBeNull();
  expect(reactionWorkspaceRedirect({ path: "/assessment", query: {} })).toBeNull();
});

test("chemistry workspaces retain one environment footer", () => {
  expect(
    navigation.flatMap((group) => group.items).map((item) => item.title),
  ).toEqual([
    "路线设计",
    "任务与路线",
    "原料检索",
    "反应与条件",
    "结构工具",
    "工艺核算",
    "实验优化",
    "环境部署",
  ]);
  expect(navigation.at(-1).placement).toBe("footer");
});

test.each(["auto", "manual", "import"])(
  "all workbench modes stay under route design: %s",
  (mode) => {
    expect(
      selected({ path: "/", query: { mode } }).map((item) => item.title),
    ).toEqual(["路线设计"]);
  },
);

test.each(["/results", "/results/123", "/documents", "/editor", "/editor/123", "/analyses", "/analyses/123"])(
  "tasks and editable copies remain one navigation family: %s",
  (path) => {
    expect(selected({ path, query: {} }).map((item) => item.title)).toEqual([
      "任务与路线",
    ]);
  },
);

test.each([
  ["/buyables", "原料检索"],
  ["/feasibility", "反应与条件"],
  ["/template", "反应与条件"],
  ["/forward", "反应与条件"],
  ["/impurity", "反应与条件"],
  ["/assessment", "结构工具"],
  ["/process", "工艺核算"],
  ["/optimization", "实验优化"],
  ["/molcom", "结构工具"],
  ["/drawing", "结构工具"],
  ["/solprop", "结构工具"],
  ["/qm", "结构工具"],
])("a tool selects one meaningful workspace: %s", (path, title) => {
  expect(selected({ path, query: {} }).map((item) => item.title)).toEqual([
    title,
  ]);
});

test("route detail and editor keep the immersive canvas without an extra tab strip", () => {
  for (const path of ["/results/123", "/editor", "/editor/123"])
    expect(sectionNavigation({ path, query: {} }, {})).toBeNull();
  expect(
    sectionNavigation({ path: "/documents", query: {} }, {}).items.map(
      (item) => item.title,
    ),
  ).toEqual(["任务记录", "研究记录", "保存的路线"]);
});

test("common tools are grouped without a cross-workspace or one-item tab strip", () => {
  expect(
    sectionNavigation({ path: "/buyables", query: {} }, readyTools),
  ).toBeNull();
  const reactions = sectionNavigation(
    { path: "/feasibility", query: {} },
    readyTools,
  );
  expect(reactions.label).toBe("反应与条件");
  expect(reactions.items.map((item) => item.title)).toEqual([
    "可行性评估",
    "模板检索",
  ]);
  expect(reactions.more).toEqual([]);
  const structures = sectionNavigation(
    { path: "/molcom", query: {} },
    readyTools,
  );
  expect(structures.label).toBe("结构工具");
  expect(structures.items.map((item) => item.title)).toEqual([
    "复杂度评估",
    "结构绘制",
  ]);
  expect(structures.more).toEqual([]);
});

test("a workspace is visible only when at least one real tool is ready", () => {
  const titles = (features) =>
    visibleNavigation(features).flatMap((group) =>
      group.items.map((item) => item.title),
    );
  expect(titles({})).toEqual(["路线设计", "任务与路线", "环境部署"]);
  expect(titles(readyTools)).toEqual([
    "路线设计",
    "任务与路线",
    "原料检索",
    "反应与条件",
    "结构工具",
    "环境部署",
  ]);
  expect(titles({ drawing: true })).toEqual([
    "路线设计",
    "任务与路线",
    "结构工具",
    "环境部署",
  ]);
  expect(navigation[1].items).toHaveLength(3);
  expect(titles({ ...readyTools, assessment: true, process: true, optimization: true })).toEqual([
    "路线设计", "任务与路线", "原料检索", "反应与条件", "结构工具", "工艺核算", "实验优化", "环境部署",
  ]);
  expect(sectionNavigation({ path: "/feasibility", query: {} }, {})).toBeNull();
  expect(
    sectionNavigation(
      { path: "/feasibility", query: {} },
      { fast_filter: true },
    ),
  ).toBeNull();
});

test("available native submodules share their reaction workspace without repeated outer tabs", () => {
  const reactions = sectionNavigation(
    { path: "/impurity", query: {} },
    {
      ...readyTools,
      conditions: true,
      forward: true,
      impurity: true,
      solubility: true,
      qm: true,
    },
  );
  expect(reactions.more).toEqual([]);
  expect(reactions.items.map((item) => item.title)).toEqual([
    "可行性评估", "模板检索", "反应条件", "产物预测", "杂质预测",
  ]);
  const structures = sectionNavigation(
    { path: "/solprop", query: { tab: "solscreen" } },
    { ...readyTools, solubility: true, qm: true, forward: true },
  );
  expect(structures.more.map((item) => item.title)).toEqual([
    "溶解度与溶剂",
    "QM 描述符",
  ]);
  expect(structures.more[0].to).toBe("/solprop?tab=solscreen");
});

test("environment controls are separate and feature-gated", () => {
  for (const path of ["/environments", "/admin", "/banlist"])
    expect(selected({ path, query: {} }).map((item) => item.title)).toEqual([
      "环境部署",
    ]);
  expect(
    sectionNavigation({ path: "/environments", query: {} }, {}),
  ).toBeNull();
  expect(
    sectionNavigation(
      { path: "/admin", query: {} },
      { native_account: true, administrator: false },
    ).items.map((item) => item.title),
  ).toEqual(["环境部署", "账号管理", "禁用规则"]);
  expect(sectionNavigation({ path: "/admin", query: {} }, { administrator: true })).toBeNull();
});

test.each([
  ["stock", "/buyables", { smiles: "CCO" }],
  ["reactions", "/feasibility", { reactants: "CCO", product: "CC=O" }],
  ["reactions", "/template", { source: "pistachio", id: "123" }],
  ["structures", "/molcom", { smiles: "C[C@H](O)CO" }],
  ["structures", "/drawing", { smiles: "[13CH3][O-].[Na+]" }],
])(
  "an active workspace preserves chemical prefill: %s %s",
  (id, path, query) => {
    expect(navigationLocation(entry(id), { path, query }, readyTools)).toEqual({
      path,
      query,
    });
  },
);

test("group entry chooses only its own ready tool and editor goes to saved routes", () => {
  const outside = { path: "/", query: {} };
  expect(
    navigationLocation(
      entry("library"),
      { path: "/editor/123", query: {} },
      {},
    ),
  ).toBe("/documents");
  expect(navigationLocation(entry("reactions"), outside, readyTools)).toBe(
    "/feasibility",
  );
  expect(
    navigationLocation(entry("reactions"), outside, { templates: true }),
  ).toBe("/template");
  expect(
    navigationLocation(entry("structures"), outside, { drawing: true }),
  ).toBe("/drawing");
  expect(
    navigationLocation(entry("structures"), outside, { solubility: true }),
  ).toBe("/solprop?tab=solpred");
});
