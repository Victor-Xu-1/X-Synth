// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Buyable Compounds Page, adding and deleting buyables", () => {
  //log in
  let username;
  let password;

  before(() => {
    // Set username and password
    cy.getUserCredentials("validRootUser").then((credentials) => {
      username = credentials.username;
      password = credentials.password;
    });
  });

  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.login(username, password);
    cy.visit("/buyables");
    cy.intercept("GET", "/api/buyables/sources").as("getSource");
    cy.wait("@getSource");
  });

  it("Add compound to buyables database", () => {
    // Test if a superser account is being used by checking for the button
    cy.get('[data-cy="add-buyables-button"]').should("be.visible");
    cy.get('[data-cy="add-buyables-button"]').click();
    cy.get('[data-cy="buyables-add-one"]').click();

    // Populate the popup with the compound info
    cy.get('[data-cy="buyable-smiles-input"]').clear("SMILES");
    cy.get('[data-cy="buyable-smiles-input"]').type("CCCCC");
    cy.get('[data-cy="buyable-ppg-input"]').clear("1");
    cy.get('[data-cy="buyable-ppg-input"]').type("1100");
    cy.get('[data-cy="buyable-source-input"]').clear("Source");
    cy.get('[data-cy="buyable-source-input"]').type("Cypress-buyables");
    cy.get('[data-cy="buyable-leadtime-input"]').clear("Lead Time");
    cy.get('[data-cy="buyable-leadtime-input"]').type("1 day");

    // Add entry to the buyables db
    cy.get('[data-cy="add-buyable-entry-button"]').click();
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .contains("Cypress-buyables")
      .should("have.length", 1);
  });

  it("Do search only on a single buyables source, Cypress-buyables", () => {
    // When land on this page, it is clear already, so just start
    cy.get('[data-cy="buyables-select-sources"]').click();

    // Deselect the following sources, only interested in the cypress-buyables source
    cy.get(".v-list-item-title").contains("LN").click();
    cy.get(".v-list-item-title").contains("SA").click();
    cy.get(".v-list-item-title").contains("EM").click();
    cy.get(".v-list-item-title").contains("CB").click();
    cy.get(".v-list-item-title").contains("MC").click();
    cy.get(".v-list-item-title").contains("CS").click();

    // Run the buyables search
    cy.get('[data-cy="buyables-search-button"]').click();

    // Check for only 1 row of data (2 including the header)
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        // Throw and error if there are more than 2 rows
        expect(row.length).be.have.eq(2);
      });

    // Check if the results table has a cell containing Cypress
    // given there is only 1 row of data, don't need to search for
    // anything else
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .find("td")
      .contains("Cypress-buyables")
      .should("exist");
  });

  it("Add compound via file upload to the buyables database", () => {
    cy.fixture("buyables_upload_test.json").as("buyables-file-upload-fixture");
    // Check that there are no Cypress entries present in buyables
    cy.get('[data-cy="buyables-select-sources"]').click();
    //cy.get('.v-list-item-title').should('not.contain', 'Cypress');// Test if a superser account is being used by checking for the button

    cy.get('[data-cy="add-buyables-button"]').should("be.visible");
    cy.get('[data-cy="add-buyables-button"]').click();
    cy.get('[data-cy="buyables-add-json"]').click();
    cy.get('[data-cy="buyables-json-upload"]').should("be.visible");
    cy.get("input[type=file]").selectFile("@buyables-file-upload-fixture", {
      force: true,
    });

    cy.get('[data-cy="buyable-upload-submit"]').click(); // This works, but data is not saved in buyables.

    cy.get('[data-cy="buyables-table"]').find("tr").should("have.length", 4);
    cy.get('[data-cy="buyable-delete-item"]').eq(0).click();
    cy.contains("Ok").click();
    cy.get('[data-cy="buyable-delete-item"]').eq(0).click();
    cy.contains("Ok").click();
    cy.get('[data-cy="buyable-delete-item"]').eq(0).click();
    cy.contains("Ok").click();
    cy.get('[data-cy="buyable-delete-item"]').eq(0).click();
    cy.contains("Ok").click();
  });

  it("Delete a single compound from buyables database", () => {
    // Check that the compound is present in buyables
    // by getting the buyables and looking for a Cypress
    //entry in the dropdown
    cy.get('[data-cy="buyables-select-sources"]').click();
    cy.get(".v-list-item-title").should("contain", "Cypress-buyables");
    // Find that specific buyable so it can be removed
    cy.get(".v-list-item-title").contains("LN").click();
    cy.get(".v-list-item-title").contains("SA").click();
    cy.get(".v-list-item-title").contains("EM").click();
    cy.get(".v-list-item-title").contains("CB").click();
    cy.get(".v-list-item-title").contains("MC").click();
    cy.get(".v-list-item-title").contains("CS").click();
    // Run the buyables search
    cy.get('[data-cy="buyables-search-button"]').click();
    // Check for only 1 row of data (2 including the header)
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .then((row) => {
        //row.length will give the row count
        cy.log(row.length); // gives number of rows
        // Throw and error if there are more than 2 rows
        expect(row.length).to.have.eq(2);
      });
    // Check if the results table has a cell containing Cypress
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .find("td")
      .contains("Cypress-buyables")
      .should("exist");

    // Now delete the compound
    cy.get('[data-cy="buyable-delete-item"]').eq(0).click();
    cy.contains("Ok").click();

    // Check if the results sources dropdown does not contain Cypress
    // Tricky here as the defaults are, when no sources are selected,
    // everything gets returned, so need a different way to check the
    // compound has been removed.
    cy.get('[data-cy="buyables-select-sources"]').click();
    cy.get(".v-list-item-title").should("not.contain", "Cypress-buyables");
  });
});
