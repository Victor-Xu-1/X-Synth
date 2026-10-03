import { createPatentLinks, normalizePatentNumber } from "./reaction-evidence";
import { safeExternalUrl } from "./external-url";

export function templateValue(value) {
  if (value === null || value === undefined || value === "") return "未记录";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function httpUrl(value) {
  if (
    typeof value !== "string" ||
    !/^https?:\/\//i.test(value) ||
    /[\s<>"]/.test(value) ||
    hasControl(value)
  )
    return null;
  return safeExternalUrl(value);
}

function hasControl(value) {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}

function doiLink(value) {
  if (typeof value !== "string") return null;
  const doi = value
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  if (!/^10\.\d{4,9}\/[^\s<>"#?]+$/.test(doi) || hasControl(doi)) return null;
  try {
    return { label: "DOI", href: `https://doi.org/${encodeURI(doi)}` };
  } catch {
    return null;
  }
}

function patentLinks(value) {
  if (typeof value !== "string") return [];
  const patent = normalizePatentNumber(value);
  if (
    !/^(?:WO\d{10}|(?:US|EP|CN|JP|KR)\d{5,12})(?:[A-Z]\d{1,2})?$/.test(patent)
  )
    return [];
  return createPatentLinks(value).map(({ label, href }) => ({ label, href }));
}

export function templateReference(reference) {
  const links = [];
  const add = (link) => {
    if (link && !links.some((item) => item.href === link.href))
      links.push(link);
  };
  let label = templateValue(reference);
  if (typeof reference === "string") {
    const url = httpUrl(reference);
    if (url) add({ label: "原始来源", href: url });
    else {
      add(doiLink(reference));
      patentLinks(reference).forEach(add);
    }
  } else if (
    reference &&
    typeof reference === "object" &&
    !Array.isArray(reference)
  ) {
    label = templateValue(
      reference.title ??
        reference.citation ??
        reference.reference ??
        reference.reaction_id ??
        reference.id ??
        reference._id ??
        reference.doi ??
        reference.DOI ??
        reference.patent_number ??
        reference,
    );
    for (const key of [
      "url",
      "reference_url",
      "source_url",
      "publication_url",
      "patent_url",
    ]) {
      const url = httpUrl(reference[key]);
      if (url) add({ label: "原始来源", href: url });
    }
    for (const key of ["doi", "DOI", "reference_doi", "publication_doi"])
      add(doiLink(reference[key]));
    for (const key of ["patent_number", "patent", "patent_id"])
      patentLinks(reference[key]).forEach(add);
  }
  return { label, links };
}
