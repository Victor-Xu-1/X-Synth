import { getMolImageUrl } from "@/common/drawing";
import { num2str } from "@/common/utils";
import { ref } from 'vue'
export const isDark = ref(false)

// Constants
const COLORS = {
  TARGET: "#007AFF",
  BUYABLE: "#FFEB3B",
  REACTANT_PRODUCT: "#0066CC",
  REACTANT_PRODUCT_NOT_BUYABLE: "#E8601C",
  DEFAULT: "#DC050C",
};

const NODE_TYPES = {
  CHEMICAL: "chemical",
  REACTION: "reaction",
};

const edgeScaling = (min, max, total, value) =>
  value >= 0.25 ? 1.0 : 16 * value * value;

const getNodeColor = (data, target) => {
  if (data.id === target) return COLORS.TARGET;
  if (data.ppg > 0)
    return data.asReactant || data.asProduct
      ? COLORS.REACTANT_PRODUCT
      : COLORS.BUYABLE;
  return data.asReactant || data.asProduct
    ? COLORS.REACTANT_PRODUCT_NOT_BUYABLE
    : COLORS.DEFAULT;
};

// Helper function to create HTML element
const createHTMLElement = (tag, innerHTML) => {
  const el = document.createElement(tag);
  el.innerHTML = innerHTML;
  return el;
};

const makeNodeTitleEl = (node) => {
  let innerHTML = node.id;
  if ("asReactant" in node)
    innerHTML += `<br>${node.asReactant} precedents as reactant`;
  if ("asProduct" in node)
    innerHTML += `<br>${node.asProduct} precedents as product`;
  if ("ppg" in node)
    innerHTML += `<br>${node.ppg > 0 ? `$${node.ppg}/g` : "not buyable"}`;
  if (node.smilesMatch)
    innerHTML += `<br>Matched buyable: ${node.smilesMatch}`;
  return createHTMLElement("div", innerHTML);
};

const makeChemicalDisplayNode = ({
  id,
  data,
  target,
  align = false,
  scale = true,
}) => ({
  id,
  smiles: data.id,
  borderWidth: data.id === target ? 3 : 2,
  color: { border: getNodeColor(data, target) },
  shape: "image",
  image: getMolImageUrl(
    data,
    false,
    true,
    align ? target : undefined,
    true,
    scale ? 80 : undefined
  ),
  title: makeNodeTitleEl(data),
  type: NODE_TYPES.CHEMICAL,
});

const modelMetadataCount = (metadata) => {
  if (Array.isArray(metadata)) return metadata.length;
  if (Number.isFinite(metadata)) return metadata;
  return "N/A";
};

const makeReactionDisplayNode = ({ id, data, detail = false }) => {
  const reactionData = data ?? { id };
  const node = {
    id,
    smiles: reactionData.id,
    font: { align: "center" },
    type: NODE_TYPES.REACTION,
  };

  if (detail) {
    const scoreType =
      reactionData.forwardScore !== undefined && reactionData.forwardScore !== null
        ? "Forward"
        : "FF";
    node.label = `${modelMetadataCount(reactionData.modelMetadata)} model(s) predicted
${scoreType} score: ${num2str(
      scoreType === "Forward" ? reactionData.forwardScore : reactionData.ffScore
    )}
Precursor score: ${num2str(reactionData.retroScore)}`;
  } else {
    node.label = `#${reactionData.rank ?? "N/A"}`;
  }

  if ("outcomes" in reactionData) {
    Object.assign(node, {
      borderWidth: 2,
      color: { border: COLORS.DEFAULT },
      title: "Selectivity warning! Select this node to see more details",
    });
  } else if ("selecError" in reactionData) {
    node.borderWidth = 2;
    node.color = { border: "#F6C141" };
  }

  return node;
};

const makeDisplayEdge = ({ id, from, to, value }) => {
  const edge = {
    id,
    from,
    to,
    color: { color: isDark.value ? "white" : "black", inherit: false },
  };

  if (value !== undefined) {
    edge.value = value;
    edge.scaling = {
      min: 1,
      max: 5,
      customScalingFunction: edgeScaling,
    };
  }

  return edge;
};

export { makeChemicalDisplayNode, makeReactionDisplayNode, makeDisplayEdge };
