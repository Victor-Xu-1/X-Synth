import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";

test("history navigation and direct route reload resolve production assets from the host root", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../vite.config.js"),
    "utf8",
  );
  const ast = parse(source, { sourceType: "module" });
  const config = ast.program.body.find(
    (node) => node.type === "ExportDefaultDeclaration",
  ).declaration.arguments[0];
  const base = config.properties.find(
    (property) => property.key.name === "base",
  ).value.value;
  expect(base).toBe("/");
  for (const pathname of [
    "/results/actual-job",
    "/editor/actual-document",
    "/forward",
  ]) {
    expect(
      new URL(
        `${base}assets/application.js`,
        `http://localhost:8769${pathname}`,
      ).pathname,
    ).toBe("/assets/application.js");
  }
});
