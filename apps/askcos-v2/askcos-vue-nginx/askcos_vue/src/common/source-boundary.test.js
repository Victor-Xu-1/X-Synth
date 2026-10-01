const fs = require("fs");
const path = require("path");

const sourceRoot = path.resolve(__dirname, "..");

const bannedMarkers = [
  "发表格式",
  "合成测试包",
  "TheSupportModal",
  "InfoSheet",
  "LogResult",
  "v-navigation-drawer",
  "expand-on-hover",
  "mode-rail",
  "workbench-sidebar",
  "$slots.sidebar",
  "侧栏功能已迁移",
  "功能模块",
  "反馈问题",
];

const allowedExtensions = new Set([".vue", ".js", ".css", ".json"]);

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["coverage", "node_modules"].includes(entry.name)) return [];
      return walkFiles(fullPath);
    }
    if (!allowedExtensions.has(path.extname(entry.name))) return [];
    return [fullPath];
  });
}

test("front-end source does not expose retired non-ASKCOS modules", () => {
  const offenders = [];
  for (const file of walkFiles(sourceRoot)) {
    const relPath = path.relative(sourceRoot, file).split(path.sep).join("/");
    if (relPath === "common/source-boundary.test.js") continue;
    const text = fs.readFileSync(file, "utf8");
    for (const marker of bannedMarkers) {
      if (text.includes(marker)) {
        offenders.push(`${relPath}: ${marker}`);
      }
    }
  }

  expect(offenders).toStrictEqual([]);
});

test("home launchpad carries former sidebar destinations inside the workbench", () => {
  const launchpadPath = path.resolve(sourceRoot, "components/home/Launchpad.vue");
  const text = fs.readFileSync(launchpadPath, "utf8");

  for (const marker of [
    "服务状态",
    "我的结果",
    "禁用列表",
    'action: "status"',
    'action: "results"',
    'action: "banlist"',
  ]) {
    expect(text).toContain(marker);
  }

  expect(text).not.toContain("核心工作台");
  expect(text).not.toContain("模块工作台");
  expect(text).not.toContain("左侧统一入口");
  expect(text).not.toContain("modules-heading");
  expect(text).not.toContain("路线实验包");
  expect(text).not.toContain("NMR 和文稿草稿");
});
