const fs = require("fs");
const path = require("path");

const appBarPath = path.resolve(__dirname, "AppBar.vue");

function readAppBar() {
  return fs.readFileSync(appBarPath, "utf8");
}

test("default app bar uses a flat glass toolbar instead of nested capsules", () => {
  const text = readAppBar();

  expect(text).toContain("global-tabbar");
  expect(text).toContain("border-bottom: 1px solid rgba(148, 163, 184, 0.18)");
  expect(text).toContain("grid-template-columns: minmax(104px, 148px) auto minmax(320px, 720px) minmax(86px, auto)");
  expect(text).toContain(".global-nav-button::after");
  expect(text).toContain("height: 2px;");
  expect(text).toContain("border-left: 1px solid rgba(148, 163, 184, 0.2)");
  expect(text).not.toContain("border-radius: 18px;");
  expect(text).not.toContain("box-shadow:\n    0 14px 36px");
  expect(text).not.toContain("background: rgba(241, 245, 249, 0.72);");
});
