/*
 * Utility functions for generating image URLs
 */

/**
 * Generates image URL using drawing API based on input options.
 * @param {Object} args
 * @param {String} args.smiles - The SMILES string to draw.
 * @param {String} args.inputType - One of 'chemical', 'reaction', or 'template'.
 * @param {Boolean} args.svg - Whether to generate SVG, PNG otherwise.
 * @param {Boolean} args.transparent - Whether to generate transparent image.
 * @param {Boolean} args.highlight - Whether to highlight atom mapping or reacting atoms.
 * @param {Boolean} args.drawMap - Whether to include atom mapping numbers.
 * @param {Array} args.reactingAtoms - Indices of reacting atoms to highlight.
 * @param {String} args.reference - Reference SMILES for aligning a molecule.
 * @param {Boolean} args.align - Whether to align reaction reactants to product.
 * @param {Boolean} args.annotate - Whether to add annotation label to image.
 * @param {Number} args.ppg - Price of chemical for annotation.
 * @param {Number} args.asReactant - Occurrences in training data as a reactant for annotation.
 * @param {Number} args.asProduct - Occurrences in training data as a product for annotation.
 * @param {Number} args.size - Length of shortest dimension of annotated image.
 */
function getImageUrl({
  smiles,
  inputType,
  svg,
  transparent,
  highlight,
  drawMap,
  reactingAtoms,
  reference,
  align,
  annotate,
  ppg,
  asReactant,
  asProduct,
  size,
}) {
  const params = new URLSearchParams();
  params.append("smiles", smiles);
  if (inputType !== undefined) {
    params.append("input_type", inputType);
  }
  if (svg !== undefined) {
    params.append("svg", svg);
  }
  if (transparent !== undefined) {
    params.append("transparent", transparent);
  }
  if (highlight !== undefined) {
    params.append("highlight", highlight);
  }
  if (drawMap !== undefined) {
    params.append("draw_map", drawMap);
  }
  if (reactingAtoms !== undefined) {
    for (const ra of reactingAtoms) {
      params.append("reacting_atoms", ra);
    }
  }
  if (reference !== undefined) {
    params.append("reference", reference);
  }
  if (align !== undefined) {
    params.append("align", align);
  }
  if (annotate !== undefined) {
    params.append("annotate", annotate);
  }
  if (ppg !== undefined) {
    params.append("ppg", ppg);
  }
  if (asReactant !== undefined) {
    params.append("as_reactant", asReactant);
  }
  if (asProduct !== undefined) {
    params.append("as_product", asProduct);
  }
  if (size !== undefined) {
    params.append("size", size);
  }
  return `/api/draw/?${params.toString()}`;
}

/**
 * Generates molecule image URL based on precursor data.
 * @param {string|Object} precursor - The precursor data.
 * @param {boolean} highlight - Whether to highlight the molecule.
 * @param {boolean} transparent - Whether to make the background transparent.
 * @param {string} reference - Reference SMILES for alignment.
 * @param {boolean} annotate - Whether to annotate the image.
 * @param {number} size - Size of the image.
 * @returns {string} The generated molecule image URL.
 */
function getMolImageUrl(
  precursor,
  highlight,
  transparent,
  reference,
  annotate,
  size
) {
  //  precursor can be
  //      1) a smiles string,
  //      2) a object with properties "reactingAtoms" and "mappedSmiles"
  //      3) a object with property "smiles"
  //      4) an object with property "precursorSmiles"
  if (typeof precursor === "string") {
    return getImageUrl({
      smiles: precursor,
      transparent,
      reference,
    });
  }
  if (annotate) {
    return getImageUrl({
      smiles: precursor.id,
      transparent,
      reference,
      annotate,
      ppg: precursor.ppg === "not buyable" ? 0 : precursor.ppg,
      asReactant: precursor.asReactant,
      asProduct: precursor.asProduct,
      size,
    });
  }
  if (highlight && precursor.mappedSmiles && precursor.reactingAtoms) {
    return getImageUrl({
      smiles: precursor.mappedSmiles,
      highlight,
      transparent,
      reactingAtoms: precursor.reactingAtoms,
      reference,
    });
  }
  if (highlight) { // tree builder -> view ipp
    let precursor_pruned = precursor.id.split(">>")[0]
    return getImageUrl({
      smiles: precursor_pruned,
      transparent,
      reference,
      annotate,
      ppg: precursor.ppg === "not buyable" ? 0 : precursor.ppg,
      asReactant: precursor.asReactant,
      asProduct: precursor.asProduct,
      size,
    });
  }


  const smiles = precursor.smiles || precursor.precursorSmiles;
  return smiles ? getImageUrl({ smiles, transparent, reference }) : "";
}

export { getImageUrl, getMolImageUrl };
