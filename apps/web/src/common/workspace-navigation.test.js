import {
  activeNavigation,
  navigation,
  researchTools,
  pageFeature,
} from "./workspace-navigation";
test("task details and editor documents retain a single selected navigation item", () => {
  for (const route of [
    { path: "/results/123", query: {} },
    { path: "/editor/123", query: {} },
    { path: "/environments", query: { tab: "monitor" } },
  ]) {
    const selected = navigation
      .flatMap((group) => group.items)
      .filter((item) => activeNavigation(item, route));
    expect(selected).toHaveLength(1);
  }
});
test("optional native subpages are keyed by actual capabilities", () => {
  for (const item of researchTools.filter((item) =>
    item.to.startsWith("/forward"),
  )) {
    const tab = new URLSearchParams(item.to.split("?")[1]).get("tab");
    expect(pageFeature({ path: "/forward", query: { tab }, meta: {} })).toBe(
      item.feature,
    );
  }
});
test("automatic and manual workbench modes select exactly one navigation entry", () => {
  for (const mode of ["auto", "manual"]) {
    const selected = navigation
      .flatMap((group) => group.items)
      .filter((item) => activeNavigation(item, { path: "/", query: { mode } }));
    expect(selected).toHaveLength(1);
    expect(selected[0].title).toBe("路线设计");
  }
  expect(pageFeature({ path: "/", query: { mode: "manual" }, meta: {} })).toBe(
    "retro",
  );
  expect(
    pageFeature({ path: "/", query: { mode: "import" }, meta: {} }),
  ).toBeNull();
});
