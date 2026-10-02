const fs = require("fs");
const path = require("path");

const settingsModalPath = path.resolve(__dirname, "SettingsModal.vue");

function readSettingsModal() {
  return fs.readFileSync(settingsModalPath, "utf8");
}

test("strategy model selector uses the shared retro option catalog instead of ready-only status", () => {
  const text = readSettingsModal();

  expect(text).toContain("getRetroModelItems");
  expect(text).toContain("getRetroTrainingSetItems");
  expect(text).toContain("getDefaultRetroTrainingSet");
  expect(text).toContain("/api/runtime/capabilities");
  expect(text).toContain("runtimeCapabilities");
  expect(text).toContain('item-title="title"');
  expect(text).toContain('item-value="value"');
  expect(text).not.toContain("filter((item) => item.name.startsWith(\"retro_\") && item.ready)");
});
