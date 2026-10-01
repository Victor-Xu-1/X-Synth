// type definitions for Cypress object "cy"
/// <reference types="cypress" />

Cypress.on('uncaught:exception', (err) => {
  // Ignore ResizeObserver loop error
  if (err.message.includes('ResizeObserver loop completed with undelivered notifications')) {
    return false;
  }
  // Throw error to fail the test for any other errors
  return true;
});

describe("Impurity Prediction Page", () => {
  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.visit("/forward?tab=impurity");
    cy.get('[data-cy="reactants"]').type("BrBr.c1ccccc1");
    cy.get('[data-cy="product"]').type("Brc1ccccc1");
  });

  it("can input Product", function () {
    cy.get('[data-cy="product"]').type("Brc1ccccc1");
  });

  it("can input Reagents", function () {
    cy.get('[data-cy="reagents"]').type("C");
  });

  it("can input Solvents", function () {
    cy.get('[data-cy="reagents"]').type("C");
    cy.get('[data-cy="solvent"]').type("ClC(Cl)(Cl)Cl");
  });

  it("Get Result - default", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
      .get("tbody").children().should("have.length.at.least", 1);
  });

  // Reaxys Inspector

  it("Get Result - WLDN - pistachio", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
    .get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - WLDN - uspto_500k", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-impurities-training-set"]').click()
    cy.contains('uspto_500k').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
    .get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - graph2smiles - USPTO_STEREO", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-impurities-model"]').click()
    cy.contains('graph2smiles').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
    .get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - graph2smiles - pistachio", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-impurities-model"]').click()
    cy.contains('graph2smiles').click()
    cy.get('[data-cy="settings-impurities-training-set"]').click()
    cy.contains('pistachio').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
    .get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - graph2smiles - USPTO_STEREO", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-impurities-model"]').click()
    cy.contains('augmented_transformer').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
    .get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - augmented_transformer - pistachio", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-impurities-model"]').click()
    cy.contains('augmented_transformer').click()
    cy.get('[data-cy="settings-impurities-training-set"]').click()
    cy.contains('pistachio').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
    .get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - augmented_transformer - pistachio - WLN inspector", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-impurities-model"]').click()
    cy.contains('augmented_transformer').click()
    cy.get('[data-cy="settings-impurities-training-set"]').click()
    cy.contains('pistachio').click()
    cy.get('[data-cy="settings-impurities-top-k"]').clear()
    cy.get('[data-cy="settings-impurities-top-k"]').type(1)
    
    cy.get('[data-cy="settings-impurities-threshold"]').clear()
    cy.get('[data-cy="settings-impurities-threshold"]').type(0.3)
    cy.get('[data-cy="settings-impurities-inspector-selection"]').click()
    cy.contains("Forward inspector").click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
    .get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - augmented_transformer - pistachio - Reaxys inspector", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-impurities-model"]').click()
    cy.contains('augmented_transformer').click()
    cy.get('[data-cy="settings-impurities-training-set"]').click()
    cy.contains('pistachio').click()
    cy.get('[data-cy="settings-impurities-top-k"]').clear()
    cy.get('[data-cy="settings-impurities-top-k"]').type(1)
    
    cy.get('[data-cy="settings-impurities-threshold"]').clear()
    cy.get('[data-cy="settings-impurities-threshold"]').type(0.3)
    cy.get('[data-cy="settings-impurities-inspector-selection"]').click()
    cy.contains("Reaxys inspector").click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
    .get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - WLN - atommapping disabled- Reaxys inspector", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[id="settings-impurities-atom-mapping"]').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
    .get("tbody").children().should("have.length.at.least", 1);
  })
  it("Get Result - WLN - atommapping enabled- Reaxys inspector", function () {
    cy.get('[data-cy="settings"]').click()
    //cy.get('[id="settings-impurities-atom-mapping"]').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="impurity-prediction-table"]')
      .get("tbody").children().should("have.length.at.least", 1);
  })

  it("Export button", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery();
    cy.get('[data-cy="impurity-prediction-export"]').click();
    cy.contains("Save").click()
    // have to rewrite this path for linux testing

    cy.readFile('cypress/downloads/impurity.csv')
  });
});
