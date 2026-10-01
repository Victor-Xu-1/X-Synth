import { storageAvailable, getFromStorage } from "@/common/utils";

const solventSets = {
  "集合 1": [
    "O",
    "CO",
    "CCO",
    "CC(C)O",
    "CC(=O)O",
    "CC#N",
    "CC(C)=O",
    "CC(=O)CC(C)C",
    "CC(=O)OC(C)C",
    "C1CCOC1",
    "COC(C)(C)C",
    "CN1CCCC1=O",
    "CS(C)=O",
    "CN(C)C=O",
    "Cc1ccccc1",
    "CCCCCCC",
  ],
  "集合 2": [
    "OCc1ccccc1",
    "CCCCO",
    "CCCO",
    "CC(C)c1ccccc1",
    "O=CO",
    "CCC(C)=O",
    "CCOC(C)=O",
    "CC1CCCO1",
    "ClCCl",
    "CN1CCN(C)C1=O",
  ],
};

function loadCustomSolventSets() {
  if (!storageAvailable("localStorage")) return;
  return getFromStorage("customSolventSets");
}

function saveCustomSolventSets(data) {
  if (!storageAvailable("localStorage")) return;
  localStorage.setItem(
    "customSolventSets",
    encodeURIComponent(JSON.stringify(data))
  );
}

export { solventSets, loadCustomSolventSets, saveCustomSolventSets };
