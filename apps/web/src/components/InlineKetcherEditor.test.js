const fs = require("fs");
const path = require("path");

const editorPath = path.resolve(__dirname, "InlineKetcherEditor.vue");

function readEditor() {
  return fs.readFileSync(editorPath, "utf8");
}

test("inline Ketcher editor scales the fixed-width Ketcher app to the available frame", () => {
  const text = readEditor();

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
  expect(text).toContain("const KETCHER_COMPACT_VIEWPORT_HEIGHT_RESERVE = 300;");
  expect(text).toContain("const syncKetcherLayout = () => {");
  expect(text).toContain("KETCHER_MIN_VIEWPORT_WIDTH,");
  expect(text).toContain("frame.getBoundingClientRect().width");
  expect(text).toContain("frame.parentElement?.clientWidth || 0");
  expect(text).toContain("const widthScale = availableWidth / KETCHER_BASE_WIDTH;");
  expect(text).toContain("const viewportWidth = window.visualViewport?.width || window.innerWidth || KETCHER_BASE_WIDTH;");
  expect(text).toContain("const viewportHeightReserve = viewportWidth <= 1120");
  expect(text).toContain("const availableParentHeight = Math.max(0, frame.parentElement?.clientHeight || 0);");
  expect(text).toContain("const parentVisualLimit = availableParentHeight >= KETCHER_MIN_VISUAL_HEIGHT");
  expect(text).toContain("viewportHeight - viewportHeightReserve");
  expect(text).toContain("if (props.fillHeight) {");
  expect(text).not.toContain("props.fillHeight && availableWidth >= KETCHER_BASE_WIDTH");
  expect(text).toContain("ketcherViewportWidth.value = availableWidth;");
  expect(text).toContain("ketcherViewportHeight.value = visualHeightLimit;");
  expect(text).toContain("const heightScale = visualHeightLimit / KETCHER_BASE_HEIGHT;");
  expect(text).toContain("Math.min(widthScale, heightScale)");
  expect(text).toContain("const nextVisualHeight = KETCHER_BASE_HEIGHT * nextScale;");
  expect(text).toContain("const ketcherViewportWidth = ref(KETCHER_BASE_WIDTH);");
  expect(text).toContain("const ketcherViewportHeight = ref(KETCHER_BASE_HEIGHT);");
  expect(text).toContain("--ketcher-viewport-height\": `${Math.round(ketcherViewportHeight.value)}px`");
  expect(text).not.toContain("viewportHeight * 0.66");
  expect(text).not.toContain("66vh");
  expect(text).toContain("new ResizeObserver(syncKetcherLayout)");
  expect(text).toContain("const scheduleKetcherLayoutSync = () => {");
  expect(text).toContain("window.requestAnimationFrame?.(() => syncKetcherLayout());");
  expect(text).toContain("window.setTimeout(syncKetcherLayout, 900);");
  expect(text).toContain("@load=\"patchKetcherDocument\"");
  expect(text).toContain("synon-ketcher-responsive-style");
  expect(text).toContain("overflow: hidden !important;");
  expect(text).toContain('body > div[role="application"]');
  expect(text).toContain('body main[role="application"]');
  expect(text).toContain('window.addEventListener("resize", syncKetcherLayout');
  expect(text).toContain('window.removeEventListener("resize", syncKetcherLayout');
  expect(text).toContain("--ketcher-scale");
  expect(text).toContain("--ketcher-viewport-width");
  expect(text).toContain("--ketcher-viewport-height");
  expect(text).toContain("height: auto;");
  expect(text).toContain("height: 100% !important;");
  expect(text).toContain(".inline-ketcher-editor.fill-height-mode");
  expect(text).toContain("@media (max-width: 1120px)");
  expect(text).toContain("min-height: clamp(360px, var(--ketcher-visual-height, 408px), 760px);");
  expect(text).toContain("clamp(420px, 52dvh, 820px)");
  expect(text).toContain("position: absolute;");
  expect(text).toContain("transform: scale(var(--ketcher-scale, 1));");
  expect(text).not.toContain("width: 100%;\n  height: 100%;");
});
