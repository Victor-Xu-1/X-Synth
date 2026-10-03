const fs = require("fs");
const path = require("path");
const source = (name) =>
  fs.readFileSync(path.resolve(__dirname, "../..", name), "utf8");

test("one transparent PNG identity serves sidebar, compact mode, mobile header and favicon", () => {
  const mark = source("components/workspace/BrandMark.vue");
  expect(mark).toContain("@/assets/brand/x-synth-logo.png");
  expect(mark).toContain(':width="size"');
  expect(mark).toContain(':height="size"');
  expect(mark).toContain('alt=""');
  expect(source("layouts/default/Sidebar.vue")).toContain("<BrandMark");
  expect(source("layouts/default/AppBar.vue")).toContain("<BrandMark");
  expect(source("styles/workbench.css")).not.toContain(
    ".workspace-brand::before",
  );
  const html = fs.readFileSync(
    path.resolve(__dirname, "../../../index.html"),
    "utf8",
  );
  expect(html).toContain(
    'rel="icon" type="image/png" href="/src/assets/brand/x-synth-logo.png"',
  );
  const png = fs.readFileSync(
    path.resolve(__dirname, "../../assets/brand/x-synth-logo.png"),
  );
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBeGreaterThan(0);
  expect(png.readUInt32BE(20)).toBeGreaterThan(0);
  expect(png[25]).toBe(6);
});
