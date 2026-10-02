// type definitions for Cypress object "cy"
/// <reference types="cypress" />

cy.on('uncaught:exception', (err) => {
  // Ignore ResizeObserver loop error
  if (err.message.includes('ResizeObserver loop completed with undelivered notifications')) {
    return false;
  }
  // Throw error to fail the test for any other errors
  return true;
});

describe("IPP Page", () => {
  /* ==== Test Created with Cypress Studio ==== */
  // Create username and password global variables
  let username;
  let password;

  before(() => {
    // Set username and password
    cy.getUserCredentials("validUser").then((credentials) => {
      username = credentials.username;
      password = credentials.password;
    });
  });

  beforeEach(() => {
    cy.viewport("macbook-11");
    //const username = Cypress.env('validUser').username
    //  const password = Cypress.env('validUser').password
    cy.login(username, password);
    cy.visit("/network?tab=IPP");

    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .type("C1CCC(OC2CCCCC2)CC1");
  });

  it("IPP Center Canvas", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.get('[data-cy="ipp-center-canvas"]').click()
  });

  it("IPP Hierarchical button click", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.get('[data-cy="ipp-hier-button"]').click();
  });

  it("IPP Screenshot", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.get('[data-cy="ipp-screenshot"]').click();

    cy.readFile('cypress/downloads/network.png')

  });

  it("IPP clear result", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.get('[data-cy="ipp-clear-result"]').click()
    cy.get('.v-btn').contains("Ok").click()
    cy.get('canvas').should('not.exist');
  });

  it("IPP not clear result", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.get('[data-cy="ipp-clear-result"]').click()
    cy.get('.v-btn').contains("Cancel").click()
    cy.get('canvas').should('exist');
  });

  it("IPP not scroll through pathways", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1");// Add a delay so the canvas can get populated
    cy.get('[data-cy="ipp-highlight-pathways"]').click()
    cy.get('[data-cy="ipp-enumerate-pathways-right"]').click()
    cy.get('[data-cy="ipp-enumerate-pathways-right"]').click()
    cy.get('[data-cy="ipp-enumerate-pathways-left"]').click()
    cy.get('[data-cy="ipp-tree-count"]').contains("Tree 2 of")

    cy.get('[data-cy="ipp-enumerate-pathways-double-right"]').click()
    cy.get('[data-cy="ipp-tree-count"]').invoke('text').should('match', /Tree (\d+) of \1/)

    cy.get('[data-cy="ipp-enumerate-pathways-double-left"]').click()
    cy.get('[data-cy="ipp-tree-count"]').contains("Tree 1 of")

  });

  it("IPP add pathways to canvas", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1");// Add a delay so the canvas can get populated
    cy.get('[data-cy="ipp-highlight-pathways"]').click()
    cy.get('[data-cy="ipp-enumerate-pathways-double-right"]').click()
    cy.get('[data-cy="ipp-tree-count"]').invoke('text').should('match', /Tree (\d+) of \1/)
    //cy.get('[data-cy="ipp-add-tree-to-network"]').click()

    cy.get('[data-cy="download-tree-to-device"]').should('be.disabled')
    cy.get('[data-cy="ipp-add-tree-to-network"]').should('be.visible')
  });

  it("IPP download specific trees to canvas", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1");// Add a delay so the canvas can get populated
    cy.get('[data-cy="ipp-highlight-pathways"]').click()
    cy.get('[data-cy="ipp-enumerate-pathways-double-right"]').click()
    cy.get('[data-cy="ipp-tree-count"]').invoke('text').should('match', /Tree (\d+) of \1/)
    //cy.get('[data-cy="ipp-add-tree-to-network"]').click()


    cy.get('[data-cy="download-tree-to-device"]').click({force: true});
    cy.readFile('cypress/downloads/treeResults.json')

  });

  it("IPP enumerate pathways", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.get('[data-cy="ipp-enumerate-pathways"]').click()
    cy.get('.v-btn').contains("Ok").click()
  });

});

