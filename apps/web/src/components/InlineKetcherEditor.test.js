const fs = require("fs");
const path = require("path");
const { compileScript, compileTemplate, parse } = require("@vue/compiler-sfc");

const editorPath = path.resolve(__dirname, "InlineKetcherEditor.vue");

function readEditor() {
  return fs.readFileSync(editorPath, "utf8");
}

test("inline Ketcher editor scales the fixed-width Ketcher app to the available frame", () => {
  const text = readEditor();
  const compact = (value) => value.replace(/\s+/g, "").replace(/,\)/g, ")");
  const statement = (value) => expect(compact(text)).toContain(compact(value));

  expect(text).toContain("const KETCHER_BASE_WIDTH = 808;");
  expect(text).toContain("const KETCHER_BASE_HEIGHT = 432;");
  expect(text).toContain("const KETCHER_MIN_VIEWPORT_WIDTH = 320;");
  expect(text).toContain("showActions");
  expect(text).toContain("fillHeight");
  expect(text).toContain('v-if="showActions"');
  expect(text).toContain("const KETCHER_MIN_SCALE = 0.2;");
  expect(text).toContain("const KETCHER_MAX_SCALE = 2.6;");
  expect(text).toContain("const KETCHER_MIN_VISUAL_HEIGHT = 420;");
  expect(text).toContain("const KETCHER_MAX_VISUAL_HEIGHT = 860;");
  expect(text).toContain("const KETCHER_VIEWPORT_HEIGHT_RESERVE = 220;");
  expect(text).toContain("const KETCHER_MEDIUM_VIEWPORT_HEIGHT_RESERVE = 250;");
  expect(text).toContain(
    "const KETCHER_COMPACT_VIEWPORT_HEIGHT_RESERVE = 300;",
  );
  expect(text).toContain("const syncKetcherLayout = () => {");
  expect(text).toContain("KETCHER_MIN_VIEWPORT_WIDTH,");
  expect(text).toContain("frame.getBoundingClientRect().width");
  expect(text).toContain("frame.parentElement?.clientWidth || 0");
  expect(text).toContain(
    "const widthScale = availableWidth / KETCHER_BASE_WIDTH;",
  );
  statement(
    "const viewportWidth = window.visualViewport?.width || window.innerWidth || KETCHER_BASE_WIDTH;",
  );
  statement("const viewportHeightReserve = viewportWidth <= 1120");
  statement(
    "const availableParentHeight = Math.max(0, frame.parentElement?.clientHeight || 0);",
  );
  statement(
    "const parentVisualLimit = availableParentHeight >= KETCHER_MIN_VISUAL_HEIGHT",
  );
  expect(text).toContain("viewportHeight - viewportHeightReserve");
  expect(text).toContain("if (props.fillHeight) {");
  expect(text).not.toContain(
    "props.fillHeight && availableWidth >= KETCHER_BASE_WIDTH",
  );
  expect(text).toContain("ketcherViewportWidth.value = availableWidth;");
  expect(text).toContain("ketcherViewportHeight.value = visualHeightLimit;");
  expect(text).toContain(
    "const heightScale = visualHeightLimit / KETCHER_BASE_HEIGHT;",
  );
  expect(text).toContain("Math.min(widthScale, heightScale)");
  expect(text).toContain(
    "const nextVisualHeight = KETCHER_BASE_HEIGHT * nextScale;",
  );
  expect(text).toContain(
    "const ketcherViewportWidth = ref(KETCHER_BASE_WIDTH);",
  );
  expect(text).toContain(
    "const ketcherViewportHeight = ref(KETCHER_BASE_HEIGHT);",
  );
  expect(text).toContain(
    '--ketcher-viewport-height": `${Math.round(ketcherViewportHeight.value)}px`',
  );
  expect(text).not.toContain("viewportHeight * 0.66");
  expect(text).not.toContain("66vh");
  expect(text).toContain("new ResizeObserver(syncKetcherLayout)");
  expect(text).toContain("const scheduleKetcherLayoutSync = () => {");
  expect(text).toContain(
    "window.requestAnimationFrame?.(() => syncKetcherLayout());",
  );
  expect(text).toContain("window.setTimeout(syncKetcherLayout, 900);");
  expect(text).toContain('@load="patchKetcherDocument"');
  expect(text).toContain("prepareKetcherDocument(doc)");
  expect(text).toContain(
    "fitKetcherCanvas(ketcherIframe.value?.contentWindow?.ketcher?.editor)",
  );
  const layout = fs.readFileSync(
    path.resolve(__dirname, "../common/ketcher-layout.js"),
    "utf8",
  );
  expect(layout).toContain("x-synth-ketcher-responsive-style");
  expect(layout).toContain("overflow: hidden !important;");
  expect(layout).toContain(".Ketcher-root");
  expect(layout).toContain('body > div[role="application"]');
  expect(layout).toContain('body main[role="application"]');
  expect(text).toContain('window.addEventListener("resize", syncKetcherLayout');
  expect(text).toContain(
    'window.removeEventListener("resize", syncKetcherLayout',
  );
  expect(text).toContain("--ketcher-scale");
  expect(text).toContain("--ketcher-viewport-width");
  expect(text).toContain("--ketcher-viewport-height");
  expect(text).toContain("height: auto;");
  expect(layout).toContain("height: 100% !important;");
  expect(text).toContain(".inline-ketcher-editor.fill-height-mode");
  expect(text).toContain("@media (max-width: 1120px)");
  statement(
    "min-height: clamp(360px, var(--ketcher-visual-height, 408px), 760px);",
  );
  expect(text).toContain("clamp(420px, 52dvh, 820px)");
  expect(text).toContain("position: absolute;");
  expect(text).toContain("transform: scale(var(--ketcher-scale, 1));");
  expect(text).not.toContain("width: 100%;\n  height: 100%;");
});

test.each(["InlineKetcherEditor.vue", "KetcherModal.vue"])(
  "%s compiles and reads only after its owned write queue settles",
  (filename) => {
    const text = fs.readFileSync(path.resolve(__dirname, filename), "utf8");
    const { descriptor, errors } = parse(text, { filename });
    expect(errors).toEqual([]);
    const script = compileScript(descriptor, { id: "editor-import" });
    expect(
      compileTemplate({
        filename,
        id: "editor-import",
        source: descriptor.template.content,
        compilerOptions: { bindingMetadata: script.bindings },
      }).errors,
    ).toEqual([]);
    expect(text).toContain("await writeMolecule.flush()");
    expect(text).toContain("editorLifetime.signal");
    expect(text).toContain("editorLifetime.abort()");
    expect(text).not.toContain("structure-read-start");
  },
);
