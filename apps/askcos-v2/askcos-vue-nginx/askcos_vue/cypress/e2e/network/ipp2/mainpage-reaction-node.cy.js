 
 
// type definitions for Cypress object "cy"
/// <reference types="cypress" />

// cy.on('uncaught:exception', (err) => {
//     /* returning false here prevents Cypress from failing the test */
//     if (resizeObserverLoopErrRe.test(err.message)) {
//         return false
//     }
// })

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
    cy.visit("/banlist")
    cy.get('[data-cy="banlist-reset"]').click()
    cy.get('[data-cy="banlist-reset"]').click()
    cy.visit("/network?tab=IPP");

    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .type("C1CCC(OC2CCCCC2)CC1");
  });

  it("Node details - Select Chemical Node", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-select"]').click();
      cy.getSelectedNodes().then((res) => expect(res.length).eq(1));
    });
  });

  it("Node details - Delete", function () {
      cy.get('[data-cy="ipp-one-step"]').click();
      cy.waitAPI();
      cy.getReactionNode("c1ccc(OC2CCCCC2)cc1>>C1CCC(OC2CCCCC2)CC1").then(
          (nodeID) => {
            cy.openNodeDetail(nodeID)
            cy.get('[data-cy="node-details-reaction-delete"]').click()
            cy.contains("Ok").click()
          }
        );
      cy.getReactionNode("c1ccc(OC2CCCCC2)cc1>>C1CCC(OC2CCCCC2)CC1").then(
          (nodeID) => {
              expect(nodeID).eq('none')
      })
  });

  it("Node details - Cluster", function () {
      cy.get('[data-cy="ipp-one-step"]').click();
      cy.waitAPI();
      cy.getReactionNode("c1ccc(OC2CCCCC2)cc1>>C1CCC(OC2CCCCC2)CC1").then(
          (nodeID) => {
            cy.openNodeDetail(nodeID)
            cy.get('[data-cy="node-details-reaction-collapse"]').click()
            .getCluster(nodeID)
            .should("match", /cluster/);
          }
        );
  });

  it("Node details - Evaluate Reaction", function () {
      cy.get('[data-cy="ipp-one-step"]').click();
      cy.waitAPI();
      cy.getReactionNode("c1ccc(OC2CCCCC2)cc1>>C1CCC(OC2CCCCC2)CC1").then(
          (nodeID) => {
            cy.openNodeDetail(nodeID)
            cy.get('[data-cy="node-details-reaction-evaluate-reaction"]')
              .invoke("removeAttr", "target")
              .click();
              cy.url().should("include", "forward?tab=context&rxnsmiles=");
          }
        );
  });

  it("Node details - Supporting Templates", function () {
      cy.get('[data-cy="ipp-one-step"]').click();
      cy.waitAPI();
      cy.getReactionNode("c1ccc(OC2CCCCC2)cc1>>C1CCC(OC2CCCCC2)CC1").then(
          (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('[data-cy="ipp-template-details"]').click()
              cy.get('#template-26')
              .invoke("removeAttr", "target")
              .click()
              cy.url().should("include", "template?id=");

          }
        );
  });

  // TODO: Need to fix this
  it("Node details - Ban Reaction", function () {
    cy.visit("/banlist")
    cy.get('[data-cy="banlist-reset"]').click()
    cy.get('[data-cy="banlist-reset"]').click()
    cy.visit("/network?tab=IPP")

    cy.get(".v-input").get('[placeholder="SMILES"]').type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getReactionNode("c1ccc(OC2CCCCC2)cc1>>C1CCC(OC2CCCCC2)CC1").then(
      (nodeID) => {
        cy.openNodeDetail(nodeID)
        cy.get('[data-cy="ban-button"]').click()
        cy.get('[data-cy="ban-description"]').type("hello")
        cy.get('[data-cy="ban-confirm-button"]').click()
        cy.contains('Ok').click()
      }
      );
    cy.get('[data-cy="ipp-clear-result"]').click({force: true})
    cy.contains('Ok').click()
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getReactionNode("c1ccc(OC2CCCCC2)cc1>>C1CCC(OC2CCCCC2)CC1").then(
      (nodeID) => {
        expect(nodeID).eq('none')
      }
    );

  });
});
