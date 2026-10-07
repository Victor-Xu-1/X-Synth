/*
 * Shared utility functions
 */

async function copyToClipboard(text, parent) {
  if (typeof text !== "string" || !text.length) return false;
  if (typeof navigator.clipboard?.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  if (!parent?.appendChild || typeof document.execCommand !== "function")
    return false;
  const opener = document.activeElement;
  const dummy = document.createElement("textarea");
  dummy.value = text;
  dummy.readOnly = true;
  dummy.tabIndex = -1;
  dummy.setAttribute("aria-hidden", "true");
  dummy.style.cssText = "position:fixed;inset:0;opacity:0;pointer-events:none;";
  try {
    parent.appendChild(dummy);
    dummy.select();
    return document.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    dummy.remove();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
}

function num2str(n, round = true, sigfigs = 2, exp = false, threshold = -4) {
  // Converts a number to a string based on the requested number of significant figures if round is true
  // Automatically uses exponential notation for small numbers, can be forced if exp is true
  if (n == null || Number.isNaN(n)) return "N/A";
  if (!round) return n.toString();
  if (exp) return n.toExponential(sigfigs - 1);

  const magnitude = n ? Math.floor(Math.log10(Math.abs(n))) : 0;
  if (magnitude <= threshold) return n.toExponential(sigfigs - 1);

  const digits = sigfigs - magnitude - 1;
  const power = 10 ** digits;
  return (Math.round(n * power) / power).toFixed(Math.max(digits, 0));
}

function storageAvailable(type) {
  let storage;
  try {
    storage = window[type];
    const x = "__storage_test__";
    storage.setItem(x, x);
    storage.removeItem(x);
    return true;
  } catch (e) {
    return (
      e instanceof DOMException &&
      (e.code === 22 ||
        e.code === 1014 ||
        e.name === "QuotaExceededError" ||
        e.name === "NS_ERROR_DOM_QUOTA_REACHED") &&
      storage &&
      storage.length !== 0
    );
  }
}

function getFromStorage(key) {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(decodeURIComponent(value)) : {};
}

function updateObj(dest, src) {
  // take properties of src and overwrite matching properties of dest
  // ignores properties in src if they do not exist in dest
  // modifies dest object in place
  Object.keys(src).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(dest, key)) {
      if (typeof dest[key] === "object" && !Array.isArray(dest[key])) {
        updateObj(dest[key], src[key]);
      } else {
        dest[key] = src[key];
      }
    }
  });
}

function normalizeRoutePublicationNode(node) {
  return {
    id: node?.id ?? node?.smiles ?? "",
    type: node?.type ?? "",
    smiles: node?.smiles ?? "",
    data: node?.data ?? {},
  };
}

function normalizeRoutePublicationEdge(edge) {
  return {
    id: edge?.id ?? `${edge?.from ?? ""}->${edge?.to ?? ""}`,
    from: edge?.from ?? "",
    to: edge?.to ?? "",
  };
}

function buildSelectedRoutePublicationPayload({
  route,
  routeIndex,
  resultInfo,
  comparisonRoutes = [],
  dataMode = "simulation",
  generationStyle = "publication",
}) {
  const graph = route?.graph ?? {};
  return {
    data_mode: dataMode,
    generation_style: generationStyle,
    target_smiles: resultInfo?.smiles ?? resultInfo?.target ?? "",
    route_index: routeIndex,
    result_id: resultInfo?.id ?? resultInfo?.result_id ?? "",
    selected_route: {
      graph,
      nodes: Array.isArray(route?.nodes)
        ? route.nodes.map(normalizeRoutePublicationNode)
        : [],
      edges: Array.isArray(route?.edges)
        ? route.edges.map(normalizeRoutePublicationEdge)
        : [],
    },
    comparison_routes: comparisonRoutes.map((candidate, index) => ({
      route_index: candidate?.route_index ?? index,
      metrics: candidate?.metrics ?? candidate?.graph ?? {},
      notes: candidate?.notes ?? "",
    })),
  };
}

function buildRoutePublicationDocumentPayload({
  publicationResult,
  experimentalData,
  sectionDrafts,
}) {
  return {
    package: publicationResult,
    experimental_data: experimentalData || {},
    section_drafts: Array.isArray(sectionDrafts) ? sectionDrafts : [],
  };
}

function createRoutePublicationDraftKey(publicationResult) {
  const selectedRoute = publicationResult?.selected_route || {};
  const resultId = selectedRoute.result_id || "unsaved-result";
  const routeIndex = selectedRoute.route_index ?? 0;
  return `askcos-route-publication:${resultId}:${routeIndex}`;
}

export {
  copyToClipboard,
  num2str,
  storageAvailable,
  getFromStorage,
  updateObj,
  buildRoutePublicationDocumentPayload,
  buildSelectedRoutePublicationPayload,
  createRoutePublicationDraftKey,
};
