import {
  activeNavigation,
  navigation,
  optionalTools,
  pageFeature,
} from "./workspace-navigation";
test("task details and editor documents retain a single selected navigation item", () => {
  for (const route of [
    { path: "/results/123", query: {} },
    { path: "/editor/123", query: {} },
  ]) {
    const selected = navigation
      .flatMap((group) => group.items)
      .filter((item) => activeNavigation(item, route));
    expect(selected).toHaveLength(1);
  }
});
test("optional native subpages are keyed by actual capabilities", () => {
  for (const item of optionalTools.filter((item) =>
    item.to.startsWith("/forward"),
  )) {
    const tab = new URLSearchParams(item.to.split("?")[1]).get("tab");
    expect(pageFeature({ path: "/forward", query: { tab }, meta: {} })).toBe(
      item.feature,
    );
  }
});
