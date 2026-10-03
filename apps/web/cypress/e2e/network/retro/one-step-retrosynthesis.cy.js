// type definitions for Cypress object "cy"
/// <reference types="cypress" />

// cy.on('uncaught:exception', (err) => {
//   // Ignore ResizeObserver loop error
//   if (err.message.includes('ResizeObserver loop completed with undelivered notifications.')) {
//     return false;
//   }
//   // Throw error to fail the test for any other errors
//   return true;
// });

Cypress.on('uncaught:exception', () => {
  // returning false here prevents Cypress from failing the test
  return false;
});


describe("One step Retro", () => {
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

    cy.visit("/network?tab=RP");

    cy.get("#retro-target").type("C1CCC(OC2CCCCC2)CC1");
  });

  it("Run Submit", function () {
    cy.get('[data-cy="retro-left-panel"]')
      .find("img")
      .should("have.attr", "alt", "C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-results"]').should("be.visible");
  });

  it("Change to Augmented transformer", function () {
    cy.get('[data-cy="retro-model"]').click();
    cy.get(".v-list").contains("augmented_transformer").click();
    cy.get('[data-cy="retro-submit"]').click();
  });

  it("Two Predictions", function () {
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-model"]').click();
    cy.get(".v-list").contains("graph2smiles").click();
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-results"]').should('contain', 'Prediction #1')
    cy.get('[data-cy="retro-results"]').should('contain', 'Prediction #2')
    cy.get('[data-cy="retro-results"]').find('tr').eq(1).children().eq(2).should('contain', 'Not Predicted')
  });

  it("Advanced Settings - exact match", function () {
    cy.get("#retro-target").clear();
    cy.get("#retro-target").type("OC(Cn1cncn1)(Cn1cncn1)c1ccc(F)cc1F");

    cy.get('[data-cy="retro-advanced"]').click()
    cy.wait(2000)
    cy.get('[data-cy="retro-model-1"] .v-input').click()
    cy.wait(2000)
    cy.get('.v-list').contains("exact_match").click()
    cy.wait(2000)
    cy.get('[data-cy="retro-advanced-save"]').click()
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-results"]').should('contain', 'Prediction #1')
    cy.get('[data-cy="retro-results"]').find('tr').eq(1).children().eq(0).find("img").should('have.attr', 'alt', 'CO.C[Si](C)(C)OC(Cn1cncn1)(Cn1cncn1)c1ccc(F)cc1F.[Na+].[OH-]')
    cy.get('[data-cy="retro-results"]').find('tr').eq(1).children().eq(1).should('contain', 'Rank')
  });

  it("Advanced Settings - augmented tranformer", function () {
    cy.get('[data-cy="retro-advanced"]').click()
    cy.wait(1000)
    cy.get('[data-cy="retro-model-1"] .v-input').click()
    cy.get('.v-list').contains("augmented_transformer").click()
    cy.wait(1000)
    cy.get('[data-cy="retro-advanced-save"]').click()
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-results"]').should('contain', 'Prediction #1')
    cy.get('[data-cy="retro-results"]').find('tr').eq(1).children().eq(0).find("img").should('have.attr', 'alt', 'C1=CCCCC1.OC1CCCCC1')
    cy.get('[data-cy="retro-results"]').find('tr').eq(1).children().eq(1).should('contain', 'Rank')
  });


  it("Advanced Settings - template relevance", function () {
    cy.get('[data-cy="retro-advanced"]').click()
    cy.get('[data-cy="retro-max-prob"] .v-field__input').clear()
    cy.get('[data-cy="retro-max-prob"] .v-field__input').type(0.7)
    cy.get('[data-cy="retro-advanced-run"]').click()
    cy.get('[data-cy="retro-results"]').should('contain', 'Prediction #1')
    cy.get('[data-cy="retro-results"]').find('td').children().filter(':contains("SCScore")').should('have.length.at.least', 2)
  });

  it("Advanced Settings - template relevance - pistachio ring breaker", function () {
    cy.get("#retro-target").clear()
    cy.get("#retro-target").type("C1CC2CCCC3CCCC(C1)C23");
    cy.get('[data-cy="retro-advanced"]').click()
    cy.get('[data-cy="retro-max-prob"] .v-field__input').clear()
    cy.get('[data-cy="retro-max-prob"] .v-field__input').type(0.9)
    cy.get('[data-cy="retro-training-set-1"] .v-field__input').click()
    cy.get('.v-list').contains("pistachio_ringbreaker").click()
    cy.get('[data-cy="retro-advanced-run"]').click()
    cy.get('[data-cy="retro-results"]').should('contain', 'Prediction #1')
    cy.get('[data-cy="retro-results"]').find('td').filter(':contains("SCScore")').should('have.length', 2);
  });

  // TODO Add template attributes value still not working
  it("Advanced Settings - template relevance - pistachio ring breaker - template attributes", function () {
    cy.get("#retro-target").clear()
    cy.get("#retro-target").type("C1CC2CCCC3CCCC(C1)C23");
    cy.get('[data-cy="retro-advanced"]').click()
    cy.wait(3000);
    cy.get('[data-cy="retro-training-set-1"] .v-field__input').click()
    cy.get('.v-list').contains("pistachio_ringbreaker").click()
    cy.get('[data-cy="retro-template-attribute-filters-add-1"]').find('.v-btn').click()
    cy.get('[data-cy="retro-template-attribute-filters-add-1"]').find('.v-btn').click()
    cy.get('[data-cy="retro-template-attribute-filters-delete-1"]').click()
    cy.get('[data-cy="retro-template-attribute-filter-type-0"]').click()
    cy.get('.v-list').contains('chiral_delta').click()
    cy.get('#retro-template-attribute-filter-value-0').clear()
    cy.get('#retro-template-attribute-filter-value-0').type(0.9)
    cy.get('[data-cy="retro-advanced-run"]').click()
    cy.get('[data-cy="retro-results"]').should('contain', 'Prediction #1')
    cy.get('[data-cy="retro-results"]').find('td').filter(':contains("SCScore")').should('have.length.at.least', 1);
  });

  it("Advanced Settings - graph2smiles", function () {
    cy.get('[data-cy="retro-advanced"]').click()
    cy.wait(1000);
    cy.get('[data-cy="retro-model-1"] .v-field__input').click()
    cy.get('.v-list').contains("graph2smiles").click()
    cy.wait(1000);
    cy.get('[data-cy="retro-training-set-1"]').click()
    cy.wait(50);
    cy.get('.v-list').contains("pistachio").click()
    cy.wait(50)
    cy.get('[data-cy="retro-advanced-run"]').click()
    cy.get('[data-cy="retro-results"]').should('contain', 'Prediction #1')
    cy.get('[data-cy="retro-results"]').find('tr').eq(1).children().eq(0).find("img").should('have.attr', 'alt', 'c1ccc(Oc2ccccc2)cc1')
    cy.get('[data-cy="retro-results"]').find('tr').eq(1).children().eq(1).should('contain', 'Rank')
  });

  it("Scroll card - Delete 1 Prediction", function () {
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-model"]').click();
    cy.get(".v-list").contains("augmented_transformer").click();
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[aria-label="Previous visual"]').click()
    cy.get('[data-cy="retro-pred-card-delete-1"]').click()
    cy.get('[data-cy="retro-results"]').should('not.contain', 'Prediction #1')

  });

  it("Edit Card Name", function () {
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-model"]').click();
    cy.get(".v-list").contains("augmented_transformer").click();
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[aria-label="Previous visual"]').click()
    cy.get('[data-cy="retro-pred-card-edit-button-1"]').click()
    cy.get('#retro-pred-card-type-1').type(' - edited')
    cy.get('[data-cy="retro-results"]').should('contain', 'Prediction #1 - edited')

  });

  it("Scroll card - Hide 1 Prediction", function () {
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-model"]').click();
    cy.get(".v-list").contains("augmented_transformer").click();
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[aria-label="Previous visual"]').click()
    cy.get('[data-cy="retro-pred-card-show-in-table-1"]').click()
    cy.get('[data-cy="retro-results"]').should('not.contain', 'Prediction #1')

  });

  it("See all prediction - Delete 1 Prediction", function () {
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-model"]').click();
    cy.get(".v-list").contains("augmented_transformer").click();
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-see-all-predictions"]').click();
    cy.wait(1000);
    cy.get('#retro-model-delete-1').click()
    cy.wait(1000);
    cy.get('[data-cy="retro-see-all-predictions-ok-btn"]').click()
    cy.get('[data-cy="retro-results"]').should('not.contain', 'Prediction #1')

  });

  it("See all prediction - Clear Prediction", function () {
    cy.get('[data-cy="retro-submit"]').click();
    cy.get('[data-cy="retro-model"]').click();
    cy.get(".v-list").contains("augmented_transformer").click();
    cy.get('[data-cy="retro-submit"]').click();
    cy.wait(1000);
    cy.get('[data-cy="retro-clear-all"]').click();
    cy.get('[data-cy="retro-right-panel"]').contains('No Prediction')
  });

});
