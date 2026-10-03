const fs = require("fs");
const path = require("path");

test("closed mobile navigation is excluded from focus and accessibility trees", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "Default.vue"), "utf8");
  expect(source).toContain(':inert="mobile && !mobileOpen ? true : undefined"');
  expect(source).toContain(':aria-hidden="mobile && !mobileOpen ? \'true\' : undefined"');
  expect(source).toContain('@navigate="mobileOpen = false"');
});
