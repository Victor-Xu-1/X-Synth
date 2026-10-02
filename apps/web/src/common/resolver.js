/*
 * External chemical name resolver utility
 */

const BASE_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/";
const PROPERTY = "property/IsomericSMILES/txt";

async function resolveChemName(name) {
  const url = `${BASE_URL}${encodeURIComponent(name)}/${PROPERTY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (
      await response.text()
    ).trim();
  } catch (error) {
    throw new Error(`Unable to resolve "${name}" to SMILES: ${error.message}`);
  }
}

export { resolveChemName };
