// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Regioselectivity Page", () => {
  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.visit("/forward?tab=selectivity");
    
    cy.get('[data-cy="reactants"]').type(
      "CC(C)OCCBr.O=c1[nH]c(=S)[nH]c2cc[nH]c12"
    );
    cy.get('[data-cy="product"]').type("CC(C)OCCn1ccc2[nH]c(=S)[nH]c(=O)c21");
    cy.get('[data-cy="reagents"]').type("O=C([O-])[O-].[K+]");
    cy.get('[data-cy="solvent"]').type("CN(C)C=O.CN(C)C=O");
  });


  it("Get Result", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery();
    cy.get('[data-cy="regioselectivity-table"]').get("tbody").children().should("have.length", 3);
  });

  it("Clear Result", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery();
    cy.get('[data-cy="clear-button"]').click();
    cy.contains('Ok').click()
    cy.get('[data-cy="regioselectivity-table"]').get("tbody").should("not.exist");
  });

  it("Export Result", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.waitCelery();
    cy.get('[data-cy="regioselectivity-export"]').click()
    cy.contains("Save").click()
    // have to rewrite this path for linux testing
    
    cy.readFile('cypress/downloads/selectivity.csv')
  });


});
