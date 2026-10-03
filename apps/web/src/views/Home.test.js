import fs from "fs";
import path from "path";

const readHome = () =>
  fs.readFileSync(path.resolve(__dirname, "Home.vue"), "utf8");

test("home shell subtracts the real app bar height to avoid page-level scrolling", () => {
  const text = readHome();

  expect(text).toContain("height: calc(100dvh - 52px);");
  expect(text).toContain("min-height: calc(100dvh - 52px);");
  expect(text).not.toContain("100dvh - 64px");
});
