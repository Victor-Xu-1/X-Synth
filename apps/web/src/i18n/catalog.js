import common from "./catalog-common";
import system from "./catalog-system";
import routes from "./catalog-routes";
import research from "./catalog-research";

export function buildCatalog(domains) {
  const zh = Object.create(null), en = Object.create(null);
  for (const entries of domains) for (const [source, translation] of entries) {
    if (typeof source !== "string" || !source.trim() || typeof translation !== "string" || !translation.trim())
      throw new TypeError("UI translations require a complete source and English pair");
    if (Object.hasOwn(en, source) && en[source] !== translation)
      throw new Error(`Conflicting UI translation: ${source}`);
    zh[source] = source;
    en[source] = translation;
  }
  return { "zh-CN": zh, en };
}

export const messages = buildCatalog([common, system, routes, research]);
