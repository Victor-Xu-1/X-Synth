// type definitions for Cypress object "cy"
/// <reference types="cypress" />


// cy.on('uncaught:exception', (err) => {
//     /* returning false here prevents Cypress from failing the test */
//     if (resizeObserverLoopErrRe.test(err.message)) {
//         return false
//     }
// })
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
    //const password = Cypress.env('validUser').password
    cy.login(username, password);

    cy.visit("/network?tab=IPP");

    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .type("C1CCC(OC2CCCCC2)CC1");
  });

  it("IPP Save Result - My Account", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitCelery();
    cy.get('[data-cy="ipp-save-results"]').click()
    cy.get('[data-cy="ipp-save-location"]').contains("My Account").click()
    cy.get("#description").type("HELLO")
    cy.get("#tags").type("vale")
    cy.get("#save").click()
    cy.visit("/results");
    cy.waitResult();
    cy.get("tbody tr").find(".v-btn").first().click()
    cy.get('#view-in-ipp').invoke("removeAttr", "target").click();
  });

  it("IPP Save Result - My PC", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitCelery();
    cy.get('[data-cy="ipp-save-results"]').click()
    cy.get('[data-cy="ipp-save-location"]').contains("My PC").click()
    cy.get('[data-cy="ipp-download-network-save"]').click()

    cy.readFile('cypress/downloads/network.json')
  });

  it("IPP Import Network", function () {
    cy.get('[data-cy="ipp-import-network"]').click();
    cy.fixture('network.json').as('network')
    cy.get('input[type=file]').selectFile('@network', { force: true })
    cy.get('[data-cy="ipp-load-file-input"]').click()
    cy.get('.v-btn').contains('Ok').click();
    // Add a test to ensure the canvas is not blank?

  });


});