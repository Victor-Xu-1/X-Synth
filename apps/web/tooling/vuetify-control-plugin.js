import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { adaptVTextField, isVTextFieldModule, VUETIFY_CONTROL_VERSION } from "./vuetify-control-semantics.js";

export function vuetifyControlSemantics(workspaceUrl) {
  const require = createRequire(workspaceUrl);
  const version = JSON.parse(readFileSync(require.resolve("vuetify/package.json"), "utf8")).version;
  if (version !== VUETIFY_CONTROL_VERSION) throw new Error("Unreviewed Vuetify control version");
  const target = require.resolve("vuetify/lib/components/VTextField/VTextField.js").replaceAll("\\", "/");
  const isTarget = id => isVTextFieldModule(id) && id.split("?")[0].replaceAll("\\", "/") === target;
  let command, applied = false;
  return {
    name: "x-synth-control-semantics",
    enforce: "pre",
    configResolved(config) { command = config.command; },
    buildStart() { applied = false; },
    load(id) {
      if (!isTarget(id)) return null;
      // Vite strips map comments before transform on its default filesystem path.
      // Keep one pinned byte source for both build and serve, including its map.
      this.addWatchFile(target); this.addWatchFile(target + ".map");
      return { code: readFileSync(target, "utf8"), map: JSON.parse(readFileSync(target + ".map", "utf8")) };
    },
    shouldTransformCachedModule({ id }) { return isTarget(id) ? true : null; },
    transform(source, id) {
      if (!isTarget(id)) return null;
      const result = adaptVTextField(source, id, version);
      applied = true;
      return result;
    },
    buildEnd(error) {
      if (!error && command === "build" && !applied) this.error("Vuetify control adaptation was not applied");
    },
  };
}
