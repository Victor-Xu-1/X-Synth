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

describe("Product Prediction Page", () => {
  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.visit("/forward?tab=forward");
    cy.get('[data-cy="reactants"]').type("BrBr.c1ccccc1");
    cy.get('[data-cy="reagents"]').type("C");
    cy.get('[data-cy="solvent"]').type("ClC(Cl)(Cl)Cl");
  });

  it("Get Result - WLDN - pistachio", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="synthesis-prediction-table"]').get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - WLDN - uspto_500k", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-forward-model-training-set"]').click()
    cy.contains('uspto_500k').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="synthesis-prediction-table"]').get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - graph2smiles - USPTO_STEREO", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-forward-prediction-model"]').click()
    cy.get('.v-list').contains('graph2smiles').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="synthesis-prediction-table"]').get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - graph2smiles - pistachio", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-forward-prediction-model"]').click()
    cy.get('.v-list').contains('graph2smiles').click()
    cy.get('[data-cy="settings-forward-model-training-set"]').click()
    cy.contains('pistachio').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="synthesis-prediction-table"]').get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - augmented_transformer - USPTO_STEREO", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-forward-prediction-model"]').click()
    cy.get('.v-list').contains('augmented_transformer').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="synthesis-prediction-table"]').get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - augmented_transformer - pistachio", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-forward-prediction-model"]').click()
    cy.get('.v-list').contains('augmented_transformer').click()
    cy.get('[data-cy="settings-forward-model-training-set"]').click()
    cy.contains('pistachio').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="synthesis-prediction-table"]').get("tbody").children().should("have.length.at.least", 1);
  });

  it("Get Result - augmented_transformer - USPTO_STEREO - change num result", function () {
    cy.get('[data-cy="settings"]').click()
    cy.get('[data-cy="settings-forward-prediction-model"]').click()
    cy.get('.v-list').contains('augmented_transformer').click()
    cy.get('[data-cy="settings-forward-model-num-results"]').clear()
    cy.get('[data-cy="settings-forward-model-num-results"]').type(1)
    cy.contains('Ok').click()
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="synthesis-prediction-table"]').get("tbody").children().should("have.length.at.least", 1);
  });


  it("Forward - Predict Regioselectivity", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('#predict-regio-selectivities-0').invoke("removeAttr", "target").click()
    cy.url().should("include", "selectivity");
  });

  it("Forward - Predict Impurities", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('#predict-impurities-0').invoke("removeAttr", "target").click()
    cy.url().should("include", "impurity");
  });

  it("CLEAR button", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="clear-button"]').click();
    cy.get("button").contains("Ok").click();
    cy.get('[data-cy="synthesis-prediction-table"]').get("tbody").should("not.exist");
  });

  it("Export button", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery()
    cy.get('[data-cy="synthesis-prediction-export"]').click();
    cy.contains("Save").click()

    cy.readFile('cypress/downloads/forward.csv')
  });
});
