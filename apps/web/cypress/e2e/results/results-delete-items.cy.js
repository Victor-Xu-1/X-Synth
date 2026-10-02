// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Testing the Results page", () => {
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

  // Run a prediction so the first Cypress Test returned
  // is based on C1CCC(OC2CCCCC2)CC1
  before(() => {
    cy.viewport("macbook-11");
    cy.intercept("GET", "/api/results/list").as("get-results");
    cy.intercept("DELETE", "/api/results/destroy*").as("del-result");

    //const username = Cypress.env('validUser').username
    //const password = Cypress.env('validUser').password
    cy.login(username, password);
    cy.visit("/network?tab=IPP");
    // Clear SMILEs input box
    cy.get(".v-input").get('[placeholder="SMILES"]').clear();
    // Add the molecule to SMILEs input box, name the prediction, then run it
    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="build-tree-drop-down"]').click();
    cy.get('[data-cy="job-name-description"]').type("Cypress Test add-delete");
    // From Cypress Studio
    // Click on Shallow Search, First result
    //cy.get('.v-card > .v-list > :nth-child(4)').click();
    cy.contains("Shallow - First result").click();
    cy.get('[data-cy="ipp-build-tree"]').click(); // click build tree
    cy.get("button").contains("Ok").click();
    // Wait until the prediction has run and is saved to results
    cy.waitCelery();
  });

  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.intercept("GET", "/api/draw/?smiles*").as("get-draw-api");
    cy.intercept("GET", "/api/results/list").as("get-results");
    cy.intercept("DELETE", "/api/results/destroy*").as("del-result");
    const username = Cypress.env("validUser").username;
    const password = Cypress.env("validUser").password;
    cy.login(username, password);
    cy.visit("/network?tab=IPP");
    // Clear SMILEs input box
    cy.get(".v-input").get('[placeholder="SMILES"]').clear();
    // Add the molecule to SMILEs input box, name the prediction, then run it
    cy.get(".v-input")
      .get('[placeholder="SMILES"]')
      .type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="build-tree-drop-down"]').click();
    cy.get('[data-cy="job-name-description"]').type("Cypress Test add-delete");
    // From Cypress Studio
    // Click on Shallow Search, First result
    //cy.get('.v-card > .v-list > :nth-child(4)').click();
    cy.contains("Shallow - First result").click();
    cy.get('[data-cy="ipp-build-tree"]').click(); // click build tree
    cy.get("button").contains("Ok").click();
    // Wait until the prediction has run and is saved to results
    cy.waitCelery();
    cy.visit("/results");
    cy.get("#results-update").click();
  });

  it("Delete Single Result", () => {
    // Search using this description, Cypress-Test, as there are lots of results
    cy.get('[data-cy="results-search-desc"]').clear();
    cy.get('[data-cy="results-search-desc"]')
      .find("input")
      .type("Cypress Test add-delete", { delay: 0 });
    // Search for result Cypress Test add-delete
    cy.get('[data-cy="results-search"]').click();
    cy.wait("@get-results", { timeout: 8000 });
    cy.get('[data-cy="results-table"]').should("be.visible");

    // Wait for the tbl to be populated before proceeding
    cy.get('[data-cy="results-table"]', { timeout: 6000 })
      .contains("td", "Cypress Test add-delete")
      .should("be.visible");
    // Check at least one instance oof Cypress Test add-delete exists
    cy.get('[data-cy="results-table"]')
      .find("tr")
      .find("td")
      .contains("Cypress Test add-delete");

    // Delete a single result by clicking on the trash can in that row
    // Here the first row will be deleted
    cy.get(
      ':nth-child(1) > :nth-child(7) > [data-cy="results-delete-single"]',
    ).click();
    cy.wait("@del-result", { timeout: 8000 });
    //cy.get(':nth-child(1) > .v-data-table__td--expanded-row > .v-btn').click();

    // Now search for the test
    cy.get('[data-cy="results-search-desc"]').clear();
    cy.get('[data-cy="results-search-desc"]')
      .find("input")
      .type("Cypress Test add-delete", { delay: 0 });
    cy.get('[data-cy="results-search"]').click();
    cy.wait("@get-results", { timeout: 8000 });

    // Check the table is visible and contains the Cypress Test add-delete string
    cy.get('[data-cy="results-table"]')
      .find("tr")
      .find("td")
      .contains("Cypress Test add-delete"); //.to.eq(1);

    // Check at ease one instance of add-delete exists
    cy.get('[data-cy="results-table"]')
      .find("tr")
      .find("td")
      .contains("Cypress Test add-delete");
  });

  it("Delete Multiple Results", () => {
    // Find all the rows that contain Cypress Test add-delete
    cy.get('[data-cy="results-search-desc"]').clear();
    cy.get('[data-cy="results-search-desc"]')
      .find("input")
      .type("Cypress Test add-delete", { delay: 0 });

    // Search for result Cypress Test add-delete
    cy.get('[data-cy="results-search"]').click();
    cy.wait("@get-results", { timeout: 8000 });

    // Check that there is at least 1 row with CYpress Test add-delete
    cy.get('[data-cy="results-table"]')
      .find("tr")
      .find("td")
      .contains("Cypress Test add-delete");

    // select the check box on the left in the results header
    // to delete multiple results
    cy.get('#results-table thead input[type="checkbox"]').check();
    cy.get('[data-cy="results-multiple-delete"]').click();
    cy.wait("@del-result", { timeout: 5000 });

    // Refresh the table and wait for the results, gives time for pages to load
    cy.get('[data-cy="results-table-update"]').click(); // Refresh the table
    cy.wait("@get-results", { timeout: 8000 });

    // Search for result Cypress Test add-delete, shoud be none left
    cy.get('[data-cy="results-search-desc"]').clear();
    cy.get('[data-cy="results-search-desc"]')
      .find("input")
      .type("Cypress Test add-delete", { delay: 0 });
    cy.get('[data-cy="results-search"]').click();
    cy.wait("@get-results", { timeout: 8000 });

    cy.get('[data-cy="results-table"]')
      .find("tr")
      .find("td")
      .should("not.contain", "Cypress Test add-delete");
  });
});
