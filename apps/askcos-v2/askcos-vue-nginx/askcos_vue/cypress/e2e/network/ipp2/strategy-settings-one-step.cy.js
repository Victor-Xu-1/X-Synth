/* eslint-disable no-unused-vars */
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
    // Listen for uncaught exceptions and handle the ResizeObserver error
    cy.on("uncaught:exception", (err, runnable) => {
      // Check if the error is a ResizeObserver loop error
      if (
        err.message.includes(
          "ResizeObserver loop completed with undelivered notifications",
        )
      ) {
        // Prevent Cypress from failing the test when this error occurs
        return false; // returning false prevents the test from failing
      }
      // Otherwise, let Cypress handle the error as usual
      return true;
    });

    cy.viewport("macbook-11");
    //const username = Cypress.env('validUser').username
    //const password = Cypress.env('validUser').password
    cy.login(username, password);
    cy.visit("/network?tab=IPP");

    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .type("C1CCC(OC2CCCCC2)CC1");
  });

  it("Wrong smiles input", function () {
    cy.get('[placeholder="SMILES"]').type("random_input");
    cy.get("button").contains("One Step").click(); // click open step
    cy.get(".v-card-title")
      .contains("Action Unsuccessful")
      .should("be.visible");
  });

  it.only("Test Resolver", function () {
    cy.get('[data-cy="ipp-searchbar"] .v-field').clear();
    cy.get('[data-cy="IPP-NIH-resolver"]').should('be.visible');
    cy.get('[data-cy="IPP-NIH-resolver"]').click();
    cy.get(".v-input").get('[placeholder="SMILES"]').type("aspirin");
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.get('[data-cy="ipp-searchbar"]')
      .find("input")
      .should("have.value", "CC(=O)OC1=CC=CC=C1C(=O)O");
  });

  it("IPP Strategy Settings", function () {
    cy.get('[data-cy="ipp-strategy-settings"]').click();
    cy.get('[data-cy="ipp-setting-reset"]').click();
    cy.get('[label-for="precursorScoring"]').find(".v-input").click();
    cy.wait(1000);
    cy.contains("SCScore").click();
    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get('[data-cy="ipp-strategy-settings"]').click();
    cy.get('[label-for="precursorScoring"]').should("contain", "SCScore");
  });

  it("IPP add Top N result to canvas", function () {
    cy.get('[data-cy="ipp-strategy-settings"]').click();
    cy.get('[data-cy="ipp-setting-reset"]').click();
    cy.get("#reactionLimit").clear();
    cy.get("#reactionLimit").type(1);
    cy.get('[data-cy="ipp-setting-save"]').click();
    cy.get('[data-cy="ipp-one-step"]').click(); // click open step
    cy.waitAPI();
    cy.get('[data-cy="ipp-highlight-pathways"]').click();
    cy.get('[data-cy="ipp-tree-count"]').contains("Tree 1");
  });

  it("IPP change min plausibility - 0.5", function () {
    cy.get('[data-cy="ipp-strategy-settings"]').click();
    cy.get("#min-plaus").clear();
    cy.get("#min-plaus").type(0.5);
    cy.get('[data-cy="ipp-setting-save"]').click();
    cy.get('[data-cy="ipp-one-step"]').click(); // click open step
    cy.waitAPI();
    cy.get('[data-cy="ipp-highlight-pathways"]').should("be.visible");
    cy.get('[data-cy="ipp-highlight-pathways"]').click();
    cy.get('[data-cy="ipp-tree-count"]').contains("Tree 1 of 6"); // possible trees decreases due to plausibility
  });

  it("IPP change top N based on model to total results", function () {
    cy.wait(1000);
    cy.get('[data-cy="ipp-strategy-settings"]').click();
    // cy.get('#modelRank').click()
    cy.get("#reactionLimit").clear();
    cy.get("#reactionLimit").type(1);
    cy.get('[data-cy="ipp-add-strategy-plan"]').click();
    cy.wait(1000);
    cy.get('[data-cy="ipp-strategy-plan-2"]').should("be.visible");
    cy.get('[data-cy="ipp-strategy-plan-2"]'); //.find("#model").click()
    cy.get('[data-cy="ipp-strategy-plan-2"]')
      .find('[data-cy="ipp_strategy_model_selection"]')
      .click();
    //cy.get('[data-cy="ipp_strategy_model_selection"]').click();
    cy.get(".v-list-item-title").contains("graph2smiles").click();
    cy.get('[data-cy="ipp-setting-save"]').click();
    cy.get('[data-cy="ipp-one-step"]').click(); // click open step
    cy.waitAPI();

    // Get a reaction that actually exists and return the nodeID, which
    // should not be none
    cy.getReactionNode("c1ccc(OC2CCCCC2)cc1>>C1CCC(OC2CCCCC2)CC1").then(
      (nodeID) => {
        expect(nodeID).not.eq("none");
      },
    );
    //cy.log("Getting reaction node which does not exist");
    cy.getReactionNode("C1=CCCCC1.Oc1ccccc1>>C1CCC(OC2CCCCC2)CC1").then(
      (nodeID) => {
        expect(nodeID).eq("none");
      },
    );
    //cy.log("Getting reaction node which does not exist");
    cy.getReactionNode("C1CCCCC1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then(
      (nodeID) => {
        expect(nodeID).eq("none");
      },
    );
  });

  // Test No Templates ------------------------------------------------
  it("IPP Strategy Settings - no model", function () {
    cy.get('[data-cy="ipp-strategy-settings"]').click();
    cy.get("#strat-close-1").click();
    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get('[data-cy="ipp-models-bar"]').should("contain", "No strategy");
    cy.get('[data-cy="ipp-one-step"]').click();
    cy.wait(1000);
    cy.get(".v-card-title").should("have.text", "Action Unsuccessful");
  });

  // Test Template relevance ---------------------------------------
  it("IPP Strategy Settings - template relevance with bkms_metabolic", function () {
    cy.get('[data-cy="ipp-strategy-settings"]').click();
    cy.get("#reactionLimit").clear();
    cy.get("#reactionLimit").type(1);
    // Check strategy is visible
    cy.get('[data-cy="ipp-strategy-plan-1"]').should("be.visible");
    // select the template relevance model
    cy.get('[data-cy="ipp-strategy-plan-1"]')
      .find('[data-cy="ipp_strategy_model_selection"]')
      .click();
    cy.get(".v-list-item-title").contains("template_relevance").click();
    // Select bkms_metabolic model
    cy.get('[data-cy="ipp-strategy-plan-1"]')
      .find('[data-cy="ipp_strategy_template_set_selection"]')
      .click();
    cy.get(".v-list-item-title").contains("bkms_metabolic").click();
    cy.get("#max_num_templates-strat-1").clear();
    cy.get("#max_num_templates-strat-1").type(500);
    cy.get("#max_cum_prob-strat-1").clear();
    cy.get("#max_cum_prob-strat-1").type(0.8);

    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get('[data-cy="ipp-models-bar"]').should(
      "contain",
      "template relevance (bkms metabolic)",
    );
    cy.get('[data-cy="ipp-one-step"]').click();
  });

  // Test augmented transformer ------------------------------------
  it("IPP Strategy Settings - add augmented transformer", function () {
    cy.get('[data-cy="ipp-strategy-settings"]').click();
    cy.wait(2000);

    //cy.get('[data-cy="ipp-add-strategy-plan"] .v-btn').click();
    cy.get('[data-cy="ipp-add-strategy-plan"]').click();
    cy.get('[data-cy="ipp-strategy-plan-2"]').should("be.visible");

    //cy.get('[data-cy="ipp-strategy-plan-2"]').find("#model").click()
    //cy.get('.v-list-item-title').contains("augmented_transformer").click()

    cy.get('[data-cy="ipp-strategy-plan-2"]')
      .find('[data-cy="ipp_strategy_model_selection"]')
      .click();
    //cy.get('[data-cy="ipp_strategy_model_selection"]').click();
    cy.get(".v-list-item-title").contains("augmented_transform").click();
    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get('[data-cy="ipp-models-bar"]').should(
      "contain",
      "template relevance",
    );
    cy.get('[data-cy="ipp-models-bar"]').should(
      "contain",
      "augmented transformer",
    );
    cy.get('[data-cy="ipp-strategy-plan-1"]').should(
      "contain",
      "template_relevance",
    );
    cy.get('[data-cy="ipp-strategy-plan-2"]').should(
      "contain",
      "augmented_transformer",
    );

    cy.get('[data-cy="ipp-one-step"]').click();
  });

  // Test Graph2smiles ---------------------------------------------
  it("IPP Strategy Settings - add graph2smiles", function () {
    //cy.get('[data-cy="ipp-strategy-settings"]').click();
    //cy.wait(2000);
    //cy.get('[data-cy="ipp-add-strategy-plan"] .v-btn').click();
    //cy.get('[data-cy="ipp-strategy-plan-2"]').find("#model").click()
    //cy.get('.v-list-item-title').contains("graph2smiles").click()

    cy.get('[data-cy="ipp-strategy-settings"]').click();
    cy.wait(2000);

    cy.get('[data-cy="ipp-add-strategy-plan"]').click();
    cy.get('[data-cy="ipp-strategy-plan-2"]').should("be.visible");
    cy.get('[data-cy="ipp-strategy-plan-2"]')
      .find('[data-cy="ipp_strategy_model_selection"]')
      .click();
    cy.get(".v-list-item-title").contains("graph2smiles").click();

    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get('[data-cy="ipp-models-bar"]').should(
      "contain",
      "template relevance",
    );
    cy.get('[data-cy="ipp-models-bar"]').should("contain", "graph2smiles");

    cy.get('[data-cy="ipp-one-step"]').click();
  });

  // Test RetroSim ---------------------------------------------
  it("IPP Strategy Settings - add retrosim", function () {
    cy.get('[data-cy="ipp-strategy-settings"]').click();
    cy.wait(2000);

    //cy.get('[data-cy="ipp-add-strategy-plan"] .v-btn').click();
    //cy.get('[data-cy="ipp-strategy-plan-2"]').find("#model").click()
    //cy.get('.v-list-item-title').contains("retrosim").click()

    cy.get('[data-cy="ipp-add-strategy-plan"]').click();
    cy.get('[data-cy="ipp-strategy-plan-2"]').should("be.visible");
    cy.get('[data-cy="ipp-strategy-plan-2"]')
      .find('[data-cy="ipp_strategy_model_selection"]')
      .click();
    cy.get(".v-list-item-title").contains("retrosim").click();

    //cy.get('#threshold-2').clear()
    //cy.get('#threshold-2').type(0.1)
    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get('[data-cy="ipp-models-bar"]').should(
      "contain",
      "template relevance",
    );
    cy.get('[data-cy="ipp-models-bar"]').should("contain", "retrosim");

    cy.get('[data-cy="ipp-one-step"]').click();

    cy.waitAPI();
    cy.getReactionNode("OC1CCCCC1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then(
      (nodeID) => {
        expect(nodeID).not.eq("none");
      },
    );
  });

  // Test Exact match ---------------------------------------------
  it("IPP Strategy Settings - add exact match", function () {
    cy.get('[data-cy="ipp-strategy-settings"]').click();
    //cy.wait(2000);
    //cy.get('[data-cy="ipp-add-strategy-plan"] .v-btn').click();
    //cy.get('[data-cy="ipp-strategy-plan-2"]').find("#model").click()
    //cy.get('.v-list-item-title').contains("exact_match").click()

    cy.get('[data-cy="ipp-add-strategy-plan"]').click();
    cy.wait(2000);
    cy.get('[data-cy="ipp-strategy-plan-2"]').should("be.visible");
    cy.get('[data-cy="ipp-strategy-plan-2"]')
      .find('[data-cy="ipp_strategy_model_selection"]')
      .click();
    cy.get(".v-list-item-title").contains("exact_match").click();

    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .clear()
      .type("CN(C)CCOC(c1ccccc1)c1ccccc1");
    cy.wait(2000);
    // Not sure if this is the correct test, will check
    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .clear()
      .type(
        "[CH3:1][c:2]1[n:3][cH:4][c:5]2[cH:6][cH:7][cH:8][c:9]([N+:12](=[O:13])[O-:14])[c:10]2[cH:11]1",
      );
    cy.wait(2000);

    cy.get('[data-cy="ipp-models-bar"]').should(
      "contain",
      "template relevance",
    );
    cy.get('[data-cy="ipp-models-bar"]').should("contain", "exact match");

    cy.get('[data-cy="ipp-one-step"]').click();

    cy.waitAPI();
    cy.getChemicalNode("Cc1cc2ccccc2cn1").then((nodeID) => {
      expect(nodeID).not.eq("none");
    });
  });
});
