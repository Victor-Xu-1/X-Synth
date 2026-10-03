// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Condition Recommendation Page", () => {
  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.visit("/forward?tab=sites");
    cy.get('[data-cy="reactants"]').type("BrBr.c1ccccc1");
  });


  it("Get Result", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.get('[data-cy="site-selectivity-table"]').get("tbody").children().should("have.length", 5);
  });

  it("Copy all reaction ids", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.get('[data-cy="get-training-reaction-ids"]').eq(1).click()
    cy.get('[data-cy="copy-all-reaction-ids"]').click(); // works but can't tell from the clipboard
    //cy.window().its('navigator.clipboard').invoke('readText').then(cy.log);
  });
  
  it("Find First 50 in Reaxys", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.get('[data-cy="get-training-reaction-ids"]').eq(2).click()
    cy.get('[data-cy="copy-all-reaction-ids"]').click();
  });

  it("Export all as Reaxys Query", function () {
    cy.get('[data-cy="submit-button"]').click();
    cy.get('[data-cy="get-training-reaction-ids"]').eq(2).click()
    cy.get('[data-cy="export-all-as-reaxys-query"]').click();

    cy.readFile('cypress/downloads/reaxys_query.json')

  });

  it("Clear button", function () {
    cy.get('[data-cy="submit-button').click();
    cy.waitCelery()
    cy.get('[data-cy="clear-button"]').click()
    cy.contains('Ok').click()
    cy.get('[data-cy="site-selectivity-table"]')
    .find("tbody").should("not.exist");
  });


});
