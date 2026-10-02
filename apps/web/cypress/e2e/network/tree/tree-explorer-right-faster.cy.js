// type definitions for Cypress object "cy"
/// <reference types="cypress" />

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

describe("Tree Explorer", () => {
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
  before(() => {
    cy.viewport("macbook-11");
    //const username = Cypress.env("validUser").username;
    //const password = Cypress.env("validUser").password;
    cy.login(username, password);

    cy.visit("/banlist")
    cy.get('[data-cy="banlist-reset"]').click()
    cy.get('[data-cy="banlist-reset"]').click()

    cy.visit("/network?tab=IPP");
    cy.get('[data-cy="ipp-strategy-settings"]').click()
    cy.contains('Strategy Settings');
    cy.get('[data-cy="ipp-settings-tree"]').click()
    cy.wait(2000)
    cy.get('[data-cy="select-tbVersion"]').click()
    cy.contains('Retro Star').click();
    cy.get('#expansionTime').clear();
    cy.get('#expansionTime').clear();
    cy.get('#expansionTime').type('5');
    /*cy.get('[label-for="expansionTime"]').clear();
    cy.get('[label-for="expansionTime"]').clear();
    cy.get('[label-for="expansionTime"]').type('5');*/
    cy.get('#maxChemicals').clear().type('100');
    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get('.v-input').get('[placeholder="SMILES"]').clear();
    cy.get('.v-input').get('[placeholder="SMILES"]').type('C1CCC(OC2CCCCC2)CC1');
    cy.get('[data-cy="build-tree-drop-down"]').click()
    cy.get('[data-cy="job-name-description"]').type('Cypress Test TB Right')
    cy.get('[data-cy="ipp-build-tree"]').click() // click one step
    //cy.get('button').contains('Ok').click()
    cy.waitCelery()
  });

  beforeEach(() => {
    cy.viewport("macbook-11");
    //const username = Cypress.env("validUser").username;
    //const password = Cypress.env("validUser").password;
    cy.login(username, password);

    cy.visit("/results");
    cy.waitResult();

    // Set up intercepts before clicking view trees
    cy.setupTreeResultIntercepts();

    cy.get('[data-cy="results-table"]').find('tr').eq(1).find('td').find('button').click()
    cy.get('[data-cy="results-view-trees"]').click()
    
    // Wait for the tree results to load
    cy.waitReloadTreeResult();
  });

  it("Legend test", function () {
    cy.wait(2000);
    //cy.get('[data-cy="tree-view-right-panel]');
    //cy.contains('button', 'Show Legend').click();
    cy.get('.v-sheet > [style="--e80c0b3e-backgroundColor: rgba(255, 255, 255, 0.8);"] > .v-btn > .v-btn__content').click();
    cy.get('.v-sheet > [style="--e80c0b3e-backgroundColor: rgba(255, 255, 255, 0.8);"] > .v-btn').click();
    //cy.contains('button', 'SHOW LEGEND').click();
    //cy.contains('button', 'HIDE LEGEND').click();
  });

  it("Select Reaction node - evaluate reaction", function () {
    cy.wait(2000);
    cy.get('[data-cy="tree-view-show-more"]').should('be.visible');
    cy.get('[data-cy="tree-explorer-save-results"]').should('be.visible');
    cy.get('[data-cy="tree-view-right-panel"]').should('be.visible');
    
    cy.getTreeReactionNode("Cc1ccc(S(=O)(=O)OC2CCCCC2)cc1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="tree-view-evaluate-reaction"]').invoke("removeAttr", "target").click()
      cy.url().should("include", "forward");
    });
  });

  it("Select Reaction node - supporting templates", function () {
    cy.getTreeReactionNode("Cc1ccc(S(=O)(=O)OC2CCCCC2)cc1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('#supporting-templates').find('a').eq(0).invoke("removeAttr", "target").click()
      cy.url().should("include", "template");

    });
  });

  it("Select Reaction node - ban reaction", function () {
    cy.getTreeReactionNode("Cc1ccc(S(=O)(=O)OC2CCCCC2)cc1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="ban-button"]').click()
      cy.get('[data-cy="ban-confirm-button"]').click()
      cy.contains('Ok').click()
    });
    // // RE RUN AGAIN ----------------------------------------
    cy.visit("/network?tab=IPP");
    cy.get('[data-cy="ipp-strategy-settings"]').click()
    cy.get('[value="mctsTB"]').click()
    // cy.get('[label-for="expansionTime"]').clear().type('10');
    cy.get('#maxChemicals').clear().type('300');
    cy.get('[data-cy="ipp-settings-general"]').click()
    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get('[data-cy="build-tree-drop-down"]').click()
    cy.get('[data-cy="job-name-description"]').type('Cypress Test2')
    cy.get('[data-cy="ipp-build-tree"]').click() // click one step
    cy.get('button').contains('Ok').click()
    cy.waitCelery()

    cy.visit("/results");
    cy.waitResult();

    
    // Set up intercepts before clicking view trees
    cy.setupTreeResultIntercepts();
    cy.contains('Cypress Test2').parents('tr').find('td').find('button').click()
    cy.get('[data-cy="results-view-trees"]').click()    
    cy.waitReloadTreeResult()
    // ------------------------------------------------------

    cy.getTreeReactionNode("Cc1ccc(S(=O)(=O)OC2CCCCC2)cc1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      expect(nodeID).eq('none')  
    });
  });

  it("Select chemical node", function () {
    cy.getTreeChemicalNode("CN(C)CCOC(c1ccccc1)c1ccccc1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="synthesize-this-in-ipp"]').invoke("removeAttr", "target").click()
      cy.url().should("include", "IPP&target=CN(C)CCOC(c1ccccc1)c1ccccc1");
    });
  });


  it("Select chemical node - ban chemical", function () {
    cy.getTreeChemicalNode("OC1CCCCC1").then((nodeID) => {
      cy.openNodeDetail(nodeID);
      cy.get('[data-cy="ban-button"]').click()
      cy.get('[data-cy="ban-confirm-button"]').click()
      cy.contains('Ok').click()
    });
    // RE RUN AGAIN ----------------------------------------
    cy.visit("/network?tab=IPP");
    cy.get('[data-cy="ipp-strategy-settings"]').click()
    cy.get('[value="mctsTB"]').click()
    // cy.get('[label-for="expansionTime"]').clear().type('10');
    cy.get('[data-cy="ipp-settings-general"]').click()
    cy.get('[data-cy="ipp-setting-save"]').click();

    cy.get('[data-cy="build-tree-drop-down"]').click()
    cy.get('[data-cy="job-name-description"]').type('Cypress Test3')
    cy.get('[data-cy="ipp-build-tree"]').click() // click one step
    cy.get('button').contains('Ok').click()
    cy.waitCelery()

    cy.visit("/results");
    cy.waitResult();

    // Set up intercepts before clicking view trees
    cy.setupTreeResultIntercepts();
    cy.contains('Cypress Test3').parents('tr').find('td').find('button').click()
    cy.get('[data-cy="results-view-trees"]').click()
    cy.waitReloadTreeResult()
    // ------------------------------------------------------

    cy.getTreeChemicalNode("OC1CCCCC1").then((nodeID) => {
      expect(nodeID).eq('none')  
    });
  });

  it("Add to IPP", function () {
    cy.get('[data-cy="add-to-ipp"]').click()
    // cy.getChemicalNode("Cc1ccc(S(=O)(=O)OC2CCCCC2)cc1").then((nodeID) => {
    //   cy.openNodeDetail(nodeID);
    // });
    // cy.get('[value="TE"]').click()
    // cy.get('[data-cy="tree-view-right"]').click({force: true})
    // cy.getReactionNode("BrC1CCCCC1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
    //   cy.openNodeDetail(nodeID);
    // });
  });
  
  it("Add to IPP from list", function () {
    cy.get('[data-cy="down-btn"]').click()
    cy.get('[data-cy="open-list-view"]').click()
    cy.get('[data-cy="add-to-ipp-list-0"]').click()
    // cy.getChemicalNode("Cc1ccc(S(=O)(=O)OC2CCCCC2)cc1").then((nodeID) => {
    //   cy.openNodeDetail(nodeID);
    // });

  });

  it("Add to window from list", function () {
    cy.get('[data-cy="down-btn"]').click()
    cy.get('[data-cy="open-list-view"]').click()
    cy.get('.v-pagination__list').find('.v-btn').eq(2).click()
    cy.get('[data-cy="view-in-main-window-3"]').click()
    cy.getTreeReactionNode("Cc1ccc(S(=O)(=O)OC2CCCCC2)cc1.OC1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then((nodeID) => {
      expect(nodeID).eq('none') // not the first page
    });
    // cy.get('[value="TE"]').click()
  });

  it("Download Trees", function () {
    cy.get('[data-cy="tree-explorer-save-results"]').click()
    cy.contains("This tree").click()
    cy.readFile('cypress/downloads/treeResults.json')
    cy.get('[data-cy="tree-explorer-save-results"]').click()
    cy.contains("All trees").click()
    cy.readFile('cypress/downloads/treeResults.json')
  });



});
