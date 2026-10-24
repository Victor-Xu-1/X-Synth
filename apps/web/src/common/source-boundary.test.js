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

test("product startup and navigation have no external analytics chain", () => {
  const markers = [
    "vue-gtag",
    "VITE_GTAG",
    "createGtag",
    "initGtag",
    "pageTracker",
    "googletagmanager",
    "google-analytics",
    "Google Analytics",
    "gtag(",
    "window.gtag",
  ];
  const offenders = [];
  const files = [
    ...walkFiles(sourceRoot).filter((file) => !/\.(test|spec)\.js$/.test(file)),
    path.join(sourceRoot, "../index.html"),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const marker of markers) {
      if (text.includes(marker))
        offenders.push(path.relative(sourceRoot, file) + ": " + marker);
    }
  }
  expect(offenders).toStrictEqual([]);
});

test("product manifests and lockfile do not retain the analytics dependency", () => {
  const webRoot = path.resolve(sourceRoot, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(webRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(webRoot, "package-lock.json"), "utf8"));
  for (const dependencies of [
    manifest.dependencies,
    manifest.devDependencies,
    lock.packages[""].dependencies,
    lock.packages[""].devDependencies,
  ]) {
    expect(dependencies).not.toHaveProperty("vue-gtag");
  }
  expect(Object.keys(lock.packages).filter((key) => /(^|\/)node_modules\/vue-gtag$/.test(key)))
    .toStrictEqual([]);
  expect(manifest.version).toBe(__X_SYNTH_VERSION__);
  expect(lock.version).toBe(manifest.version);
  expect(lock.packages[""].version).toBe(manifest.version);
});

test("plugin registration keeps locale, theme, stores, time, dialogs, auth and router only", () => {
  jest.isolateModules(() => {
    const plugins = {
      language: {}, vuetify: {}, pinia: {}, timeago: {},
      dialogs: {}, auth: {}, router: {}, locale: {},
    };
    const initializeLocale = jest.fn();
    const createGtag = jest.fn(() => ({ analytics: true }));
    jest.doMock("../plugins/vuetify", () => ({ __esModule: true, default: plugins.vuetify }));
    jest.doMock("../store", () => ({ __esModule: true, default: plugins.pinia }));
    jest.doMock("../router", () => ({ __esModule: true, default: plugins.router }));
    jest.doMock("vuetify-use-dialog", () => ({ __esModule: true, default: plugins.dialogs }));
    jest.doMock("../plugins/keycloak", () => ({ __esModule: true, default: plugins.auth }));
    jest.doMock("vue-timeago3", () => ({ __esModule: true, default: plugins.timeago }));
    jest.doMock("date-fns/locale/en-US", () => ({ __esModule: true, default: plugins.locale }));
    jest.doMock("@/i18n", () => ({ __esModule: true, default: plugins.language, initializeLocale }));
    jest.doMock("vue-gtag", () => ({ createGtag }), { virtual: true });
    const app = { use: jest.fn().mockReturnThis() };
    require("../plugins").registerPlugins(app);
    expect(initializeLocale).toHaveBeenCalledTimes(1);
    expect(app.use.mock.calls).toStrictEqual([
      [plugins.language],
      [plugins.vuetify],
      [plugins.pinia],
      [plugins.timeago, {
        locale: plugins.locale,
        defaultConverterOptions: { addSuffix: true },
      }],
      [plugins.dialogs],
      [plugins.auth],
      [plugins.router],
    ]);
    expect(createGtag).not.toHaveBeenCalled();
  });
});

test("App retains awaited public config initialization, theme and locale wiring", () => {
  const { parse, compileScript } = require("@vue/compiler-sfc");
  const source = fs.readFileSync(path.join(sourceRoot, "App.vue"), "utf8");
  const { descriptor, errors } = parse(source);
  expect(errors).toStrictEqual([]);
  const { scriptSetupAst } = compileScript(descriptor, { id: "startup-privacy-contract" });
  const hook = (name) => scriptSetupAst.find((node) =>
    node.type === "ExpressionStatement" &&
    node.expression.type === "CallExpression" &&
    node.expression.callee.name === name,
  ).expression.arguments[0];
  expect(hook("onBeforeMount").async).toBe(true);
  expect(hook("onBeforeMount").body.body[0]).toMatchObject({
    type: "ExpressionStatement",
    expression: {
      type: "AwaitExpression",
      argument: {
        type: "CallExpression",
        callee: {
          type: "MemberExpression",
          object: { name: "configStore" },
          property: { name: "init" },
        },
      },
    },
  });
  expect(hook("onMounted").body.body[0]).toMatchObject({
    expression: { type: "CallExpression", callee: { name: "initTheme" } },
  });
  expect(descriptor.template.content).toContain(':locale="widgetLocale"');
  expect(descriptor.template.content).toContain("<router-view");
});

test.each([null, "True", "False", " opaque email policy "])(
  "retained config initialization consumes optional email strings verbatim: %s",
  async (value) => {
    const rows = value === null ? [] : [{ key: "VITE_EMAIL_REQUIRED", value }];
    const get = jest.fn().mockResolvedValue(rows);
    let store;
    jest.isolateModules(() => {
      jest.doMock("./api", () => ({ API: { get } }));
      const { createPinia, setActivePinia } = require("pinia");
      setActivePinia(createPinia());
      store = require("../store/config").useConfigStore();
    });
    await store.init();
    expect(get.mock.calls).toStrictEqual([
      ["/api/frontend-config/get-all-config", null, false],
    ]);
    expect(store.envs).toStrictEqual(value === null ? {} : { VITE_EMAIL_REQUIRED: value });
    const account = fs.readFileSync(path.join(sourceRoot, "views/login/AccountLoginForm.vue"), "utf8");
    expect(account).toContain('config.envs.VITE_EMAIL_REQUIRED === "True"');
  },
);
