// type definitions for Cypress object "cy"
/// <reference types="cypress" />

// cypress/support/index.js

Cypress.on('uncaught:exception', (err) => {
  // Ignore ResizeObserver loop error
  if (err.message.includes('ResizeObserver loop completed with undelivered notifications')) {
    return false;
  }
  if (err.message.includes("Cannot set properties of undefined (setting 'evaluating')")) {
    return false; // prevent Cypress from failing the test
  // Throw error to fail the test for any other errors
  }
  return true;
});

describe("Condition Recommendation Page", () => {
  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.visit("/forward?tab=context");
    cy.get('[data-cy="reactants"]').type("ClC1CCCCC1.OC1CCCCC1");
    cy.get('[data-cy="product"]').type("C1CCC(OC2CCCCC2)CC1");
  });

  it("can input Reactants", function () {
    cy.get('[data-cy="reactants"]').type("BrBr.c1ccccc1");
  });

  it("can input Product", function () {
    cy.get('[data-cy="reactants"]').type("BrBr.c1ccccc1");
    cy.get('[data-cy="product"]').type("Brc1ccccc1");
  });

  it("Click to open the setting menu", function () {
    cy.get("button").contains("Settings").click();
    cy.get(".v-card-title").should("be.visible");
  });

  it("Extra settings options test", function () {
    cy.get('[data-cy="settings"]').click();
    cy.wait(1000);
    cy.get('[data-cy="settings-cond-rec-model"]').click();
    cy.wait(1000);
    cy.contains('QUARC (Quantity Prediction)').click()
    // These options are no longer available
    //cy.get('[data-cy="settings-model-type"]').click();
    //cy.contains('Graph').click()
    cy.get('[data-cy="settings-num-results"]').clear();
    cy.get('[data-cy="settings-num-results"]').clear(); //Just to make sure that the field is cleared
    cy.get('[data-cy="settings-num-results"]').type(1)
    cy.get('[data-cy="ok-btn"]').click()
    cy.get('[data-cy="submit-button').click();
    cy.waitCelery()
    cy.get('[data-cy="forward-condition-recommendation-table"]')
      .get("tbody").children().should("have.length", 1);

  });

  it("Test Condition Recommendation Neural Network model", function () {
    cy.get('[data-cy="submit-button').click();
    cy.get("tbody").children().should("have.length", 10);
  });

  it("Test Condition Recommendation Neural Network model", function () {
    cy.get('[data-cy="submit-button').click();
    cy.waitCelery()
    cy.get('[data-cy="forward-condition-recommendation-table"]')
      .get("tbody").children().should("have.length", 10);

  });

  it("Test Condition Recommendation QUARC model", function () {
    cy.get('[data-cy="model"]').click()
    cy.get('.v-list').contains('QUARC').click()
    cy.get('[data-cy="submit-button').click();
    cy.waitCelery()
    cy.get('[data-cy="forward-condition-recommendation-table"]')
      .get("tbody").children().should("have.length", 10);

  });

  it("Clear button", function () {
    cy.get('[data-cy="submit-button').click();
    cy.get('[data-cy="forward-condition-recommendation-table"]')
      .get("tbody").children().should("have.length", 10);
    cy.get('[data-cy="clear-button"]').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="forward-condition-recommendation-table"]')
    .get("tbody").should("not.exist");
  });

  it("Get Reaction Score", function () {
    cy.get('[data-cy="submit-button').click();
    cy.waitCelery();
    cy.get('[data-cy="cond-rec-get-reaction-score"]').click()
    cy.get('[data-cy="forward-condition-recommendation-table"]')
    .find("p").eq(0).should("contain.text", "Reaction score: ")
  });

});

