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
