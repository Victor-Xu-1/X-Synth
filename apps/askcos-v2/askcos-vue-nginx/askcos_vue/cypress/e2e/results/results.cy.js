// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Testing the Results page", () => {
  /* ==== Test Created with Cypress Studio ==== */
  // Create username and password global variables
  let username;
  let password;

  // Run a prediction so the first Cypress Test returned 
  // is based on C1CCC(OC2CCCCC2)CC1
  before(() => {
    // Set username and password
    cy.getUserCredentials("validUser").then((credentials) => {
      username = credentials.username;
      password = credentials.password;
    });
  });

  before(() => {
    cy.viewport("macbook-11");

    cy.intercept("GET", "/api/results/list").as("get-results");
    cy.intercept("DELETE", "/api/results/destroy*").as("del-result");

    //const username = Cypress.env('validUser').username
    //const password = Cypress.env('validUser').password
    cy.login(username, password);
    cy.visit("/network?tab=IPP");
    // Clear SMILEs input box
    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .clear();
    // Add the molecule to SMILEs input box, name the prediction, then run it
    cy.get('.v-input').get('[placeholder="SMILES"]').type('C1CCC(OC2CCCCC2)CC1');
    cy.get('[data-cy="build-tree-drop-down"]').click();
    cy.get('[data-cy="job-name-description"]').type('Cypress Test C1CCC(OC2CCCCC2)CC1');
    // From Cypress Studio
    // Click on Shallow Search, First result
    //cy.get('.v-card > .v-list > :nth-child(4)').click();
    cy.contains('Shallow - First result').click();
    cy.get('[data-cy="ipp-build-tree"]').click() // click build tree
    cy.get('button').contains('Ok').click()
    // Wait until the prediction has run and is saved to results
    cy.waitCelery()
  });

  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.intercept("GET", "/api/draw/?smiles*").as("get-draw-api");
    cy.intercept("GET", "/api/results/list").as("get-results");
    cy.intercept("DELETE", "/api/results/destroy*").as("del-result");
    //const username = Cypress.env('validUser').username
    //const password = Cypress.env('validUser').password
    cy.login(username, password);
    cy.visit("/results");
    cy.get("#results-update").click();

    // Set up the searches earch using this compound, C1CCC(OC2CCCCC2)CC1
    // The SMILEs were replaced with descriptive text so need to change the search criteria
    cy.get('[data-cy="results-search-desc"]')
      .find('input')
      .type('Cypress Test C1CCC(OC2CCCCC2)CC1', { delay: 0 });
    cy.get('[data-cy="results-search-desc"]')
      .find('input')
      .should('have.value', 'Cypress Test C1CCC(OC2CCCCC2)CC1');
    //.should('have.value', 'C1CCC(OC2CCCCC2)CC1');
  });

  it("Search for result descriptions, a specific SMILES string", () => {
    // Search using this compound, C1CCC(OC2CCCCC2)CC1, as there are lots of results
    //cy.get('[data-cy="results-search"]').click();
    //cy.wait("@get-results", { timeout: 8000 });
    // Wait for the tbl to be populated before proceeding
    cy.get('[data-cy="results-table"]', { timeout: 6000 })
      .contains('td', "Cypress Test C1CCC(OC2CCCCC2)CC1")
      //.contains('td', "C1CCC(OC2CCCCC2)CC1")
      .should('be.visible');
    // Check table has data in it
    cy.get('[data-cy="results-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        expect(row.length).to.eq(2); // Only check for 4 or more rows, add the header and check for 11 rows
      });
  });

  it("View result in Tree Explorer", () => {
    // Search using this compound, C1CCC(OC2CCCCC2)CC1, as there are lots of results
    cy.get('[data-cy="results-search"]').click();
    cy.wait("@get-results", { timeout: 8000 });
    // Wait for the table to be populated before proceeding
    cy.get('[data-cy="results-table"]', { timeout: 6000 })
      .contains('td', "Cypress Test C1CCC(OC2CCCCC2)CC1")
      //.contains('td', "C1CCC(OC2CCCCC2)CC1")
      .should('be.visible');
    // Check table has data in it
    cy.get('[data-cy="results-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        expect(row.length).to.eq(2); // As only showing 10 rows, add the header and check for 11 rows
      });
    // Click on the expand button on the first row to expose the view options
    cy.get(':nth-child(1) > .v-data-table__td--expanded-row > .v-btn').click();
    cy.get('[data-cy="results-view-trees"]').click();

    // Check the correct page has been requested and is loading
    cy.url().should('contain', 'network?tab=TE');
    // Wait for the canvas to load
    cy.get('canvas', { timeout: 8000 }).should('be.visible');

    // Check that the canvas contains the smiles C1CCC(OC2CCCCC2)CC1
    // Changed this to BrC(c1ccccc1)c1ccccc1 as the previous string was
    // not there
    /* ==== Generated with Cypress Studio ==== */
    cy.get('canvas').click(); // Reaction node window appears
    //cy.contains('BrC(c1ccccc1)c1ccccc1'); 
    cy.get('.smiles')
      .should('contain', 'C1CCC(OC2CCCCC2)CC1');
    /* ==== End Cypress Studio ==== */
  });

  it("View results in IPP", () => {
    // Search using this compound, C1CCC(OC2CCCCC2)CC1, as there are lots of results
    cy.get('[data-cy="results-search"]').click();
    // Wait for the table to be populated before proceeding
    cy.get('[data-cy="results-table"]', { timeout: 6000 })
      .contains('td', "Cypress Test C1CCC(OC2CCCCC2)CC1")
      //.contains('td', "C1CCC(OC2CCCCC2)CC1")
      .should('be.visible');
    // Check table has data in it
    cy.get('[data-cy="results-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        expect(row.length).to.eq(2); // As only showing 10 rows, add the header and check for 11 rows
      });
    // Click on the expand button on the first row to expose the view options
    cy.get(':nth-child(1) > .v-data-table__td--expanded-row > .v-btn').click();
    cy.get('[data-cy="results-view-ipp"]').click();

    // Check the correct page has been requested and is loading
    cy.url().should('contain', 'network?tab=IPP');
    cy.get('canvas', { timeout: 10000 }).should('be.visible');
    // Wait for canvas to be fully populated
    cy.wait("@get-draw-api", { timeout: 8000 });

    // Find the chemical node of interest
    cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
      (nodeID) => {
        //cy.log(nodeID);
        cy.openNodeDetail(nodeID); // Open the node details and check compound is there
        cy.get('[data-cy="ipp-node-details-smiles"]', { timeout: 4000 }).click({ force: true }); //Copy SMILES to clipboard
        cy.get('[data-cy="ipp-node-details-smiles"]')
          .should('contain', 'C1CCC(OC2CCCCC2)CC1');
      }
    );
  });

  it("Click on view settings", () => {
    // Check the new window opens and certain metadata are populated
    // Search using this compound, C1CCC(OC2CCCCC2)CC1, as there are lots of results
    cy.get('[data-cy="results-search"]').click();
    // Wait for the table to be populated before proceeding
    cy.get('[data-cy="results-table"]', { timeout: 6000 })
      .contains('td', "Cypress Test C1CCC(OC2CCCCC2)CC1")
      //.contains('td', "C1CCC(OC2CCCCC2)CC1")
      .should('be.visible');
    // Check table has data in it
    cy.get('[data-cy="results-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        expect(row.length).to.eq(2); // As only showing 10 rows, add the header and check for 11 rows
      });

    // Click on the expand button on the first row to expose the view options
    cy.get(':nth-child(1) > .v-data-table__td--expanded-row > .v-btn').click();
    cy.get('[data-cy="results-view-settings"]').click();
    //cy.get('#settings').contains('C1CCC(OC2CCCCC2)CC1');
    //cy.wait(3000)
    cy.get('[data-cy="tree-builder-settings-table"]', { timeout: 9000 }).should('be.visible');
    cy.get('[data-cy="tree-builder-settings-table"]').should('contain', 'C1CCC(OC2CCCCC2)CC1');
    cy.get('[data-cy="results-tree-builder-settings-close"]').click();
  });

  it("Click on share result", function () {
    // Click on the Share result button, a pop up appears with a URL
    // Check this popup to ensure it does contain a valid URL
    // Check the URL links to a page (get a 200 response)
    cy.get('[data-cy="results-search"]').click();
    // Wait for the table to be populated before proceeding
    cy.contains('[data-cy="results-table"] td', "Cypress Test C1CCC(OC2CCCCC2)CC1")
      .should('be.visible');
    // Check table has data in it
    cy.get('[data-cy="results-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        expect(row.length).to.eq(2); // As only showing 10 rows, add the header and check for 11 rows
      });

    // Click on the expand button on the first row to expose the view options
    cy.get(':nth-child(1) > .v-data-table__td--expanded-row > .v-btn').click();
    cy.get('[data-cy="results-share-result"]').click();
    //cy.wait(3000)
    cy.get('[data-cy="results-share-link-text"]', { timeout: 7000 }).should('be.visible');
    cy.get('[data-cy="results-share-link-text"]')
      .find('input')  // find the URL
      .invoke('val')  // obtain the URL
      .then((val) => {
        cy.visit(val);  //Test if share works
        // Big timeout as my machine is slow, check page is displayed fully first
        cy.get('[data-cy="results-share-modal-popup"]', { timeout: 15000 }).should('be.visible');
        // Check if the target compound is listed on the page, should be
        cy.get('[data-cy="results-share-modal-popup"]')
          .contains("C1CCC(OC2CCCCC2)CC1")
        // Close the modal
        //cy.get('[data-cy="results-close-shared-modal"]').click();
      })
  });

  after("Delete Result created", () => {
    cy.visit("/results");
    //cy.get("#results-update").click();

    // Set up the searches earch using this compound, C1CCC(OC2CCCCC2)CC1
    // The SMILEs were replaced with descriptive text so need to change the search criteria
    cy.get('[data-cy="results-search-desc"]')
      .find('input')
      .type('Cypress Test C1CCC(OC2CCCCC2)CC1', { delay: 0 });
    // Search for result Cypress Test C1CCC(OC2CCCCC2)CC1
    cy.get('[data-cy="results-search"]').click();
    cy.wait("@get-results", { timeout: 8000 });

    // Check that there is at least 1 row with CYpress Test add-delete
    cy.get('[data-cy="results-table"]', { timeout: 6000 })
      .find("tr")
      .find("td")
      .contains('Cypress Test C1CCC(OC2CCCCC2)CC1');

    // select the check box on the left in the results header
    // to delete multiple results
    cy.get('#results-table thead input[type="checkbox"]').check();
    cy.get('[data-cy="results-multiple-delete"]').click();
    cy.wait("@del-result", { timeout: 5000 });
    cy.wait(3000);

    // Refresh the table and wait for the results, gives time for pages to load
    cy.get('[data-cy="results-table-update"]').click(); // Refresh the table
    cy.wait("@get-results", { timeout: 8000 });

    // Search for result Cypress Test add-delete, shoud be none left
    cy.get('[data-cy="results-search-desc"]').clear();
    cy.get('[data-cy="results-search-desc"]')
      .find('input')
      .type('Cypress Test C1CCC(OC2CCCCC2)CC1', { delay: 0 });
    cy.get('[data-cy="results-search"]').click();
    cy.wait("@get-results", { timeout: 8000 });

    cy.get('[data-cy="results-table"]')
      .should('contain', 'No data available')
  });
});
