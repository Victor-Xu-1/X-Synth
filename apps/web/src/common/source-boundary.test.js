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

test("workspace has one navigation authority and no retired route renderer", () => {
  const navigation = fs.readFileSync(
    path.join(sourceRoot, "common/workspace-navigation.js"),
    "utf8",
  );
  for (const marker of [
    "路线设计",
    "任务与路线",
    "研究工具",
    "原料检索",
    "反应与条件",
    "结构工具",
    "工艺核算",
    "实验优化",
    "环境部署",
  ])
    expect(navigation).toContain(marker);
  for (const retired of [
    "components/home/Launchpad.vue",
    "views/network/Network.vue",
    "store/results.js",
  ]) {
    expect(fs.existsSync(path.join(sourceRoot, retired))).toBe(false);
  }
});
