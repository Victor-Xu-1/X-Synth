const fs = require("fs");
const path = require("path");
test("workspace header reads actual route and service status without duplicate navigation", () => {
  const text = fs.readFileSync(path.resolve(__dirname, "AppBar.vue"), "utf8");
  expect(text).toContain("route.meta.title");
  expect(text).toContain("workspace.ready");
  expect(text).toContain("toggle-navigation");
  expect(text).not.toContain("global-tabbar");
  expect(text).not.toContain("SearchBar");
});
