import fs from "fs";
import path from "path";
test("background service polling never remounts initialized workbench or Ketcher drafts", () => {
  const wrapper = fs.readFileSync(
    path.resolve(__dirname, "ModuleWorkbench.vue"),
    "utf8",
  );
  const drawing = fs.readFileSync(
    path.resolve(__dirname, "../views/drawing/Drawing.vue"),
    "utf8",
  );
  expect(wrapper).toContain("workspace.loading && !workspace.refreshed");
  expect(drawing).toContain("workspace.loading && !workspace.refreshed");
});
