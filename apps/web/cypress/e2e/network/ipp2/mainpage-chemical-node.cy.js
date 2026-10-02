// type definitions for Cypress object "cy"
/// <reference types="cypress" />

cy.on("uncaught:exception", (err) => {
  // Ignore ResizeObserver loop error
  if (
    err.message.includes(
      "ResizeObserver loop completed with undelivered notifications",
    )
  ) {
    return false;
  }
  // Throw error to fail the test for any other errors
  return true;
});

describe("IPP Page, Chemical node", () => {
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
  /* ==== Test Created with Cypress Studio ==== */
  beforeEach(() => {
    cy.viewport("macbook-11");
    //const username = Cypress.env('validUser').username
    //const password = Cypress.env('validUser').password
    cy.login(username, password);
    cy.visit("/banlist");
    cy.get('[data-cy="banlist-reset"]').click();
    cy.get('[data-cy="banlist-reset"]').click();
    cy.visit("/network?tab=IPP");

    cy.get(".v-input").get('[placeholder="SMILES"]').clear();

    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .type("C1CCC(OC2CCCCC2)CC1"); 
  });

  it("Node details - Select", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-select"]').click();
    });
  });

  it("Node details - Delete Root Node", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    // cy.getReactionNode("OC1CCCCC1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").should('exist');
    cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-delete"]').click();
      cy.contains("Ok").click({force:true});
      //cy.getReactionNode("OC1CCCCC1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").should('not.exist');
      /*cy.getReactionNode("O=C1CCCCC1.O=C1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then(
        (nodeID) => {
          expect(nodeID).eq("none");
        },*/
      //);
    });
    //cy.getReactionNode("OC1CCCCC1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").should('not.exist');
  });

  it("Node details - Delete Children Node", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-delete"]').click();
      cy.contains("Ok").click();
      cy.getReactionNode("c1ccc(OC2CCCCC2)cc1>>C1CCC(OC2CCCCC2)CC1").then(
        (nodeID) => {
          expect(nodeID).not.eq("none");
        },
      );
    });
  });

  it("Node details - Collapse Root Node", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-collapse"]')
        .click()
        .getCluster(nodeID)
        .should("match", /cluster/);
    });
  });

  it("Node details - Cluster Root Node", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-collapse"]')
        .click()
        .getCluster(nodeID)
        .should("match", /cluster/);
    });
  });

  it("Node details - Add Notes", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-view-notes"]').click();
      cy.get('[data-cy="node-details-add-note"]').click();
      cy.get("#note-user-name").type("Hello");
      cy.get("#note-comment").type("Description");
      cy.get('[data-cy="network-view_button_save-note"]').click();
      cy.contains("Ok").click();
      // Close the panel by clicking on the canvas in the corner
      cy.get("canvas").click(10, 10, { force: true });
    });
    cy.get('[data-cy="ipp-center-canvas"]').click();
    cy.wait(2000);
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get("#note-title-0").should("contain", "Hello");
      cy.get("#note-comment-0").should("contain", "Description");
      cy.get("#note-edit-button-0").should("not.be.disabled");
      cy.get('[data-cy="node-details-add-note"]').click();
      cy.get("#note-user-name").type("Hello2");
      cy.get("#note-comment").type("Description2");
      cy.get('[data-cy="network-view_button_save-note"]').click();
      cy.contains("Ok").click();
      cy.get("canvas").click(10, 10, { force: true });
    });
    cy.get('[data-cy="ipp-center-canvas"]').click();
    cy.wait(2000);
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get("#note-title-1").should("contain", "Hello2");
      cy.get("#note-comment-1").should("contain", "Description2");
      cy.get("#note-edit-button-0").should("not.be.disabled");
    });
  });

  it("Node details - Note cancel edit, save edit, comment edit", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-view-notes"]').click();
      cy.get('[data-cy="node-details-add-note"]').click();
      cy.get("#note-user-name").type("Hello");
      cy.get("#note-comment").type("Description");
      cy.get('[data-cy="network-view_button_save-note"]').click();
      cy.contains("Ok").click();
      cy.get("#note-edit-button-0").click();
      cy.get("#note-edit-comment-0").clear();
      cy.get("#note-edit-comment-0").type("Description3");
      cy.get("#note-edit-cancel-change-0").click();
      cy.get("#note-title-0").should("contain", "Hello");
      cy.get("#note-comment-0").should("contain", "Description");

      //------------------------------------
      cy.get("#note-edit-button-0").click();
      cy.get("#note-edit-comment-0").clear();
      cy.get("#note-edit-comment-0").type("Description3");
      cy.get("#note-edit-save-change-0").click();
      cy.get("#note-title-0").should("contain", "Hello");
      cy.get("#note-comment-0").should("contain", "Description3");

      // -----------------------------------
      cy.get("#note-edit-button-0").click();
      cy.get("#note-edit-delete-note-0").click();
      cy.contains("Ok").click();
      cy.get("#note-title-0").should("not.exist");
      cy.get("#note-comment-0").should("not.exist");
    });
  });

  it("Node details - Add precursor", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-add-precursor"]').click();
      cy.get("#node-details-clustering-add-precursor-smiles").type("CCCC");
      cy.get("#node-details-clustering-add-precursor-confirm").click();
      cy.get("canvas").click(10, 10, { force: true });
    });
    cy.get('[data-cy="ipp-center-canvas"]').click();
    cy.wait(2000);
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.contains("CCCC");

      //cy.get('#card-undefined').should('be.visible')
    });
  });

  it("Node details - View Recommended Templates", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-view-recommended-templates"]').click();
      //cy.wait(1000);
      cy.contains("bkms_metabolic").click();
      //cy.get('[data-cy="template-set-bkms_metabolic"]').should('exist'); // Not working as expected
      //cy.get('[data-cy="template-set-bkms_metabolic"]').click()
      cy.get('[data-cy="recom-template-apply-template-2"]').click();
      cy.contains("c1ccc(OC2CCCCC2)cc1");
      // Can't find the img, so look for the SMILES on the page instead
      // Could also add a check to ensure the table is populated, more than 1 row?
      //cy.get('tbody > :nth-child(2) > :nth-child(5)').find("img")
      //  .should("have.attr", "alt");
      cy.get('[data-cy="recom-template-close"]').click();
    });
  });

  it("Node details - Sort Order Precursor", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-sort-by"]').click();
      cy.get(".v-list-item-title").contains("Synthetic Complexity").click();
      //cy.get('#card-32').should('be.visible')
      //cy.get('[data-cy="node-details-sort-order"]').click()
      //cy.get('#card-2').should('be.visible')
    });
  });

  it("Node details - Buyables page ", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="node-details-search-buyables"]')
        .invoke("removeAttr", "target")
        .click();
      cy.url().should("include", "buyables?q=c1ccc(OC2CCCCC2)cc1");
    });
  });

  // YET TO FINISH
  it("Node details - Ban Button ", function () {
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="ban-button"]').click();
      cy.get('[data-cy="ban-description"]').type("hello");
      cy.get('[data-cy="ban-confirm-button"]').click();
      cy.contains("Ok").click();
    });
    cy.get('[data-cy="ipp-clear-result"]').click({ force: true });
    cy.contains("Ok").click();
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.waitAPI();
    cy.getChemicalNode("c1ccc(OC2CCCCC2)cc1").then((nodeID) => {
      expect(nodeID).eq("none");
    });
  });
});
