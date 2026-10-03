// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Banlist Chemicals Page, adding, deleting and uploading", () => {
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
    cy.intercept("DELETE", "/api/banlist/chemicals/delete").as("delChemicals");
    cy.intercept("DELETE", "/api/banlist/reactions/delete").as("delReactions");
    cy.intercept("GET", "/api/banlist/chemicals").as("getChemicals");
    cy.intercept("GET", "/api/banlist/reactions").as("getReactions"); 

    cy.login(username, password);
    cy.visit("/banlist");
  });

  it("Clear the Chemical banlist", () => {
    // Checks if the chemical banlist is already clear 
    // and if not clears it
    cy.get('[data-cy="banlist-reset"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').should("be.visible");
    // Select the chemical ban list
    cy.contains('Chemicals').should("be.visible");
    cy.contains('Chemicals').click();
    cy.wait(2000);
    //cy.wait("@getChemicals");
    cy.get('body').then($body => {
      // If there in no data in the table, we're done
      if ($body.text().includes('No Ban Items')) {
      return;
      }
      // Otherwise clear the table
      cy.get('[data-cy="banlist-reset"]').should("be.visible");
      cy.get('[data-cy="banlist-reset"]').click();
      cy.wait(3000);
    });
    // Final check for an empty chemicals banlist
    // Check certain elements are on the page, delay tactic
    cy.get('[data-cy="banlist-add-single-entry"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').should("be.visible");
    cy.contains('Chemicals').click();
    cy.contains("No Ban Items");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 0);
  });

  it("Add chemical to banlist", () => {
    // Test if a superser account is being used by checking for the button
    cy.get('[data-cy="banlist-reset"]').should("be.visible");
    cy.get('[data-cy="banlist-reset"]').click();
    cy.wait(2000);

    cy.contains('Chemicals').should("be.visible");
    cy.get('[data-cy="banlist-add-single-entry"]').should("be.visible");
    cy.get('[data-cy="banlist-add-single-entry"]').click();
    //cy.wait("@getChemicals");
    cy.wait(1000);
    cy.get('[data-cy="banlist-new-entry-select"]').should('be.visible');
    cy.get('[data-cy="banlist-new-entry-select"]').click();
    cy.get(".v-list-item-title").contains("chemicals").click();
   
    cy.get('[data-cy="banlist-new-smiles-input" ]').clear();
    cy.get('[data-cy="banlist-new-smiles-input" ]').type("CCCCC");
    cy.get('[data-cy="banlist-new-description"]').clear();
    cy.get('[data-cy="banlist-new-description"]').type("Cypress-chemical-banlist-test CCCCC");
    cy.get('[data-cy="banlist-new-submit"]').click();

    cy.get('[data-cy="banlist-table"]').should('be.visible');
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 3);
    cy.get('[data-cy="banlist-table"]')
        .find("tr")
        .find("td")
        .contains("Cypress-chemical-banlist-test")
        //.contains("CCCCC")
        .should("exist");
  });

  it("Delete single chemical from banlist", () => {
    // Test if a superser account is being used by checking for the button
    cy.get('[data-cy="banlist-reset"]').should("be.visible");

    cy.contains('Chemicals').should("be.visible");
    cy.get('[data-cy="banlist-add-single-entry"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 3);
    cy.get('[data-cy="banlist-single-delete"]').should("be.visible");
    cy.get('[data-cy="banlist-single-delete"]').click();
    //cy.wait("@delChemicals");
    cy.wait(2000);
    // Test to ensure there are no entries in the table
    cy.contains("No Ban Items");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 0);
  });

  it("Add chemicals to the banlist via file upload", () => {
    cy.get('[data-cy="banlist-reset"]').should("be.visible");
    cy.get('[data-cy="banlist-reset"]').click();
    cy.fixture("banlist_sample_chemicals.json").as("banlist-chemical-upload-fixture");
    cy.contains('Chemicals').should("be.visible");
    cy.contains('Chemicals').click();
    cy.get('[data-cy="banlist-add-multiple-entries"]').should("be.visible");
    cy.get('[data-cy="banlist-add-multiple-entries"]').click();
    
    // Select the file to upload using the fixture
    cy.get("input[type=file]").selectFile("@banlist-chemical-upload-fixture", {
      force: true,
    });

    cy.get('[data-cy="banlist-file-upload"]').click(); // Upload into the banlist.

    // Check entries have been added to the table, should be 4 from the file + 1 from previous test = 5
    cy.get('[data-cy="banlist-table"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 5);
  });

  it("Delete all chemicals and reactions from banlist", () => {
    cy.get('[data-cy="banlist-reset"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').should("be.visible");
    cy.contains('Chemicals').should("be.visible");
    cy.contains('Chemicals').click();
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 5);
    cy.get('[data-cy="banlist-table"]')
        .find("tr")
        .find("td")
        .contains("Cypress-chemical-banlist-test-from-file")
        .should("exist");

    cy.get('[data-cy="banlist-reset"]').click();
    cy.wait(2000);
    //cy.wait("@getChemicals", { timeout: 8000 } );
    //cy.wait("@getReactions", { timeout: 8000 } );
    
    // Check there are no banned chemicals
    cy.contains('Chemicals').should("be.visible");
    cy.contains('Chemicals').click();
    cy.contains("No Ban Items");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 0);
  });
});
