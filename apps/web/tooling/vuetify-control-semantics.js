import { createHash } from "node:crypto";
import MagicString from "magic-string";

export const VUETIFY_CONTROL_VERSION = "3.13.6";
export const VTEXTFIELD_SOURCE_SHA256 = "7f048735857ff441e64e6099e972c9193e5f56aeb884bcb92f196fce0d4e0573";
const moduleSuffix = "/vuetify/lib/components/VTextField/VTextField.js";
const wrapperRole = '            "role": props.role\n';
const inputRole = '                "role": props.role,\n';
const inputValidity = '                "aria-invalid": isValid.value === false || undefined,\n';

export function isVTextFieldModule(id) {
  return typeof id === "string" && id.split("?")[0].replaceAll("\\", "/").endsWith(moduleSuffix);
}

export function adaptVTextField(source, id, version) {
  if (!isVTextFieldModule(id)) throw new Error("Unexpected Vuetify control module");
  if (version !== VUETIFY_CONTROL_VERSION) throw new Error("Unreviewed Vuetify control version");
  if (typeof source !== "string" || createHash("sha256").update(source).digest("hex") !== VTEXTFIELD_SOURCE_SHA256) {
    throw new Error("Vuetify control source changed; review the semantics adaptation");
  }
  const start = source.indexOf(wrapperRole);
  if (start < 0 || source.indexOf(wrapperRole, start + wrapperRole.length) !== -1) {
    throw new Error("Ambiguous Vuetify wrapper role site");
  }
  const input = source.indexOf(inputRole);
  if (input < 0 || source.indexOf(inputRole, input + inputRole.length) !== -1) {
    throw new Error("Ambiguous Vuetify native input site");
  }
  // Keep the native input role; its containing field is not a second widget.
  const code = new MagicString(source);
  code.overwrite(start, start + wrapperRole.length - 1, " ".repeat(wrapperRole.length - 1));
  code.appendLeft(input + inputRole.length, inputValidity);
  return { code: code.toString(), map: code.generateMap({ source: id, includeContent: true, hires: true }) };
}
