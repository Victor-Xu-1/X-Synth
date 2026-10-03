// type definitions for Cypress object "cy"
/// <reference types="cypress" />

// cypress/support/index.js

Cypress.on('uncaught:exception', (err) => {
  // We can ignore certain errors by returning false
  if (err.message.includes('Cannot read properties of null (reading \'activatorEl\')')) {
    return false;
  }
  if (err.message.includes('ResizeObserver loop completed with undelivered notifications')) {
    return false;
  }
  // Let Cypress handle all other errors
  return true;
});


describe("Tree Explorer", () => {
  /* ==== Test Created with Cypress Studio ==== */
  beforeEach(() => {
    cy.viewport("macbook-11");
    const username = Cypress.env('validUser').username
    const password = Cypress.env('validUser').password
    cy.login(username, password);
    
    cy.visit("/banlist")
    cy.get('[data-cy="banlist-reset"]').click()
    //cy.get('[data-cy="banlist-reset"]').click()

    cy.visit("/network?tab=IPP");
    cy.get('[data-cy="ipp-strategy-settings"]').click()
    cy.get('[value="mctsTB"]').click()
    cy.wait(2000)
    cy.get('[label-for="tbVersion"]').click()
    cy.get('[data-cy="select-tbVersion"]').click();
    cy.contains('Retro Star').click()
    // cy.get('[label-for="expansionTime"]').clear();
    // cy.get('[label-for="expansionTime"]').type('10');
    cy.get('#maxChemicals').clear().type('100');
    cy.get('[data-cy="ipp-settings-general"]').click()
    // cy.get('[data-cy="ipp-add-strategy-plan"]').click();
    // cy.get('[data-cy="ipp-strategy-plan-2"]').find("#model").click()
    // cy.get('.v-list-item-title').contains("graph2smiles").click()

    cy.get('[data-cy="ipp-setting-save"]').click();
    cy.get('.v-input').get('[placeholder="SMILES"]').type('CN(C)CCOC(c1ccccc1)c1ccccc1');
    cy.get('[data-cy="build-tree-drop-down"]').click()
    cy.get('[data-cy="job-name-description"]').type('Cypress Test')
    cy.get('[data-cy="ipp-build-tree"]').click() // click build tree
    cy.get('button').contains('Ok').click()
    cy.waitCelery()

    cy.visit("/results");
    cy.waitResult();

    // Set up intercepts before clicking view trees
    cy.setupTreeResultIntercepts();

    cy.get('[data-cy="results-table"]').find('tr').eq(1).find('td').find('button').click()
    cy.get('[data-cy="results-view-trees"]').click()
    
    // Wait for the tree results to load
    cy.waitReloadTreeResult();
  });

  it("View Tree - Show More", function () {
    cy.get('[data-cy="tree-view-show-more"]').click()
    cy.get('[data-cy="tree-builder-result-details"]').click()
    cy.get('[data-cy="tree-builder-job-settings"]').click()
    cy.get('[data-cy="tree-builder-job-statistics"]').click()
    cy.contains("Ok").click()
  });

  it("Add results to IPP network - add by tree", function () {
    cy.get('#tree-view-first-N-trees').clear()
    cy.get('#tree-view-first-N-trees').type(5)
    cy.get('[data-cy="tree-view-add-by-trees-to-ipp"]').click()
    // Navigate to IPP tab and wait for network to load
    cy.get('[value="IPP"]').click()
    cy.wait(2000);
    cy.getReactionNodeCount().then( // need to count just the leaf reaction nodes
      (length) => {
        expect(length).eq(5)
      }
    )
  });

  it("Add results to IPP network - add by depth", function () {
     cy.get('#tree-view-top-N').clear()
     cy.get('#tree-view-top-N').type(5)
     cy.get('#tree-view-depth').clear()
     cy.get('#tree-view-depth').type(2)
     cy.get('[data-cy="tree-view-add-by-depth-to-ipp"]').click()
     cy.get('[data-cy="ipp-center-canvas"]').click()
     cy.wait(1000);
     cy.getReactionNodeCount().then(
       (length) => {
         expect(length).eq(5)
       }
     )
  });

  it("Score and cluster", function () {
    cy.get('[data-cy="tree-view-score-and-cluster"]').click()
    cy.contains("Ok").click()
    cy.waitCelery()
    cy.setupTreeResultIntercepts();
    cy.reload()
    cy.waitReloadTreeResult()
    cy.get('#clusterSwitch').click()
    cy.get('[data-cy="tree-view-cluster-right"]').click()
    cy.get('[data-cy="tree-view-cluster-right"]').click()
  });

  it("Run reaction classification", function () {
    cy.get('[data-cy="tree-view-run-reaction-classification"]').click()
    cy.contains("Ok").click()
    cy.waitCelery()
    cy.setupTreeResultIntercepts();
    cy.reload()
    cy.waitReloadTreeResult()
    cy.getTreeReactionNode("BrC(c1ccccc1)c1ccccc1.CN(C)CCO>>CN(C)CCOC(c1ccccc1)c1ccccc1").then(
      (nodeID) => {
        cy.openNodeDetail(nodeID);
        cy.get('[data-cy="tree-view-reaction-properties"]').find('#reaction-class').should('not.have.text')

    })
  });

  it("Run PMI calculation - For this tree only", function () {
    cy.get('[data-cy="tree-view-run-pmi-calculation"]').click()
    cy.get('.v-list').contains('For this tree only').click()
    cy.contains("Ok").click()
    cy.waitCelery()
    cy.setupTreeResultIntercepts();
    cy.reload()
    cy.waitReloadTreeResult()
    cy.get('[data-cy="tree-view-right-panel"]').find('tr').should('contain', 'Avg. PMI')
  });

  it("Run PMI calculation - For all trees", function () {
    cy.get('[data-cy="tree-view-run-pmi-calculation"]').scrollIntoView().click()
    cy.get('.v-list').contains('For all trees').click()
    cy.contains("Ok").click()
    cy.waitCelery()
    cy.setupTreeResultIntercepts();
    cy.reload()
    cy.waitReloadTreeResult()
    cy.get('[data-cy="tree-view-right"]').click()
    cy.get('[data-cy="tree-view-right"]').click()
    cy.get('[data-cy="tree-view-right-panel"]').find('tr').should('contain', 'Avg. PMI')
  });
  
  it("Run Count analogs - For this tree only", function () {
      cy.get('[data-cy="tree-view-right"]').click()
      cy.get('[data-cy="tree-view-right"]').click() // go to the second tree
      cy.get('[data-cy="tree-view-count-analogs"]').scrollIntoView().click()
      cy.get('.v-list').contains('For this tree only').click()
      cy.contains("Ok").click()
      cy.waitCelery()
      cy.setupTreeResultIntercepts();
      cy.reload()
      cy.waitReloadTreeResult()
      cy.get('[data-cy="tree-view-right"]').click({force: true})
      cy.get('[data-cy="tree-view-right"]').click({force: true})
      cy.get('[data-cy="tree-view-right-panel"]').find('tr').should('not.contain', 'N/A')
  });
  
  it("Run Count analogs - For all trees", function () {
    cy.get('[data-cy="tree-view-count-analogs"]').scrollIntoView().click()
    cy.get('.v-list').contains('For all trees').click()
    cy.contains("Ok").click()
    cy.waitCelery()
    cy.setupTreeResultIntercepts();
    cy.reload()
    cy.waitReloadTreeResult()
    cy.get('[data-cy="tree-view-right"]').click({force: true})
    cy.get('[data-cy="tree-view-right"]').click({force: true})
    cy.get('[data-cy="tree-view-right"]').click({force: true})
    cy.get('[data-cy="tree-view-right-panel"]').find('tr').should('not.contain', 'N/A')
  });
  
  it("Sorting", function () {
    cy.get('[data-cy="sort-trees-options-1"]').find('[data-cy="order-rmv-btn"]').click()
    cy.get('[data-cy="tree-build-add-sort-field"]').click()
    cy.get('[data-cy="sort-trees-options-1"]').find('[data-cy="order-btn"]').click()
    cy.getTreeReactionNode("BrC(c1ccccc1)c1ccccc1.CN(C)CCO>>CN(C)CCOC(c1ccccc1)c1ccccc1").then(
        (nodeID) => {
          expect(nodeID).eq('none')
    })
    cy.getTreeReactionNode("c1ccc(Cc2ccccc2)cc1>>c1ccc([CH+]c2ccccc2)cc1").then(
        (nodeID) => {
          cy.openNodeDetail(nodeID)
    })
    cy.get('[data-cy="sort-trees-options-1"]').find('.v-input').click()
    cy.contains('First step score').click()
    cy.getTreeChemicalNode("CN(C)CCCl").then(
        (nodeID) => {
          cy.openNodeDetail(nodeID)
    })
  });
  
  it("Filter trees by SMILES", function () {
    // filter by starting materials
    cy.get('[data-cy="filter-sm"]').click()
    cy.contains('C=O').click()
    // cy.contains('CC=O').scrollIntoView().click()
    cy.getTreeChemicalNode("C=O").then(
      (nodeID) => {
        cy.openNodeDetail(nodeID)
    })
    cy.get('[data-cy="filter-intermediates"]').click()
    cy.contains('CN(C)CCOC(c1ccccc1)c1ccccc1').click()
    cy.getTreeChemicalNode("CN(C)CCOC(c1ccccc1)c1ccccc1").then(
      (nodeID) => {
        cy.openNodeDetail(nodeID)
    })
    
  });
  
  it("Filter trees by image", function () {
    // filter by starting materials
    cy.get('[data-cy="select-sm-by-image"]').click()
    cy.get('[data-cy="sm-img-card"]').eq(0).find('input').check()
    cy.get('[data-cy="Ok"]').click()
    cy.get('[data-cy="select-intr-by-image"]').click()
    cy.get('[data-cy="intermediate-img-card"]').eq(0).find('input').check()
    cy.get('[data-cy="Ok"]').click()
    cy.getTreeChemicalNode("BrC(c1ccccc1)c1ccccc1").then(
      (nodeID) => {
        cy.log(nodeID)
        cy.openNodeDetail(nodeID)
    })
  });



});
