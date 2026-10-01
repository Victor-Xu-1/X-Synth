// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Banlist Reactions Page, adding, deleting and uploading", () => {
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

  it("Clear the Reaction banlist", () => {  
    cy.contains('Reactions').should("be.visible");
    cy.contains('Reactions').click();

    cy.get('body').then($body => {
      // If tere are no banned reactions, we're done
      if ($body.text().includes('No Ban Items')) {
      return;
      }
      // Otherwise clear the table
      cy.get('[data-cy="banlist-reset"]').should("be.visible");
      cy.get('[data-cy="banlist-reset"]').click();
      cy.wait(2000);
    });
    // Check certain elements are on the page, delay tactic
    cy.get('[data-cy="banlist-add-single-entry"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').should("be.visible");
    cy.contains('Reactions').should("be.visible");
    // Click on the reactions tab and make sure no 
    // entries exist in the table.
    cy.contains('Reactions').click();
    cy.contains("No Ban Items");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 0);
  });

  it("Add a reaction to the banlist", () => {
    // Test if a superser account is being used by checking for the button
    cy.get('[data-cy="banlist-reset"]').should("be.visible");
    cy.get('[data-cy="banlist-reset"]').click();

    cy.contains('Reactions').should("be.visible");
    cy.contains('Reactions').click();
    cy.get('[data-cy="banlist-add-single-entry"]').should("be.visible");
    cy.get('[data-cy="banlist-add-single-entry"]').click();
    //cy.wait("@getChemicals");
    cy.wait(2000);
    cy.get('[data-cy="banlist-new-entry-select"]').should('be.visible');
    cy.get('[data-cy="banlist-new-entry-select"]').click();
    cy.get(".v-list-item-title").contains("reactions").click();
   
    cy.get('[data-cy="banlist-new-smiles-input" ]').clear();
    cy.get('[data-cy="banlist-new-smiles-input" ]').type("Fc1ccc(C2(Cn3cncn3)CO2)c(F)c1.c1nc[nH]n1");
    cy.get('[data-cy="banlist-new-description"]').clear();
    cy.get('[data-cy="banlist-new-description"]').type("Cypress-reaction-banlist-test Fluconazole");
    cy.get('[data-cy="banlist-new-submit"]').click();

    cy.get('[data-cy="banlist-table"]').should('be.visible');
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 3);
    cy.get('[data-cy="banlist-table"]')
        .find("tr")
        .find("td")
        .contains("Cypress-reaction-banlist-test")
        .should("exist");
  });

  it("delete reaction from banlist", () => {
    // Test if a superser account is being used by checking for the button
    cy.get('[data-cy="banlist-reset"]').should("be.visible");

    cy.contains('Reactions').should("be.visible");
    cy.contains('Reactions').click();
    cy.get('[data-cy="banlist-add-single-entry"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 2);
    cy.get('[data-cy="banlist-single-delete"]').should("be.visible");
    cy.get('[data-cy="banlist-single-delete"]').click();
    //cy.wait("@delChemicals");
    cy.wait(2000);
    
    cy.get('[data-cy="banlist-add-single-entry"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').should('be.visible');   
    cy.contains('Reactions').should("be.visible");
    cy.contains('Reactions').click();
    cy.contains("No Ban Items");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 0);
  });

  it("Add reactions to the banlist via file upload", () => {
    cy.get('[data-cy="banlist-reset"]').should("be.visible");
    cy.get('[data-cy="banlist-reset"]').click();

    cy.fixture("banlist_sample_reactions.json").as("banlist-reaction-upload-fixture");
    cy.contains('Reactions').should("be.visible");
    cy.contains('Reactions').click();
    cy.get('[data-cy="banlist-add-multiple-entries"]').should("be.visible");
    cy.get('[data-cy="banlist-add-multiple-entries"]').click();
    
    // Select the file to upload using the fixture
    cy.get("input[type=file]").selectFile("@banlist-reaction-upload-fixture", {
      force: true,
    });

    cy.get('[data-cy="banlist-file-upload"]').click(); // Upload inot the banlist.

    // Check entries have been added to the table, should be 4 from the file + 1 from previous test = 5
    cy.contains('Reactions').should("be.visible");
    cy.contains('Reactions').click();
    cy.get('[data-cy="banlist-table"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 5);
  });

  it("Delete all Reactions from banlist, clean up", () => {
    cy.get('[data-cy="banlist-reset"]').should("be.visible");
    cy.get('[data-cy="banlist-table"]').should("be.visible");
    cy.contains('Reactions').should("be.visible");
    cy.contains('Reactions').click();
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 5);
    cy.get('[data-cy="banlist-table"]')
        .find("tr")
        .find("td")
        .contains("Cypress-reaction-banlist-test")
        .should("exist");

    cy.get('[data-cy="banlist-reset"]').click();
    cy.wait(2000);
    cy.get('[data-cy="banlist-reset"]').click();
    //cy.wait("@getChemicals", { timeout: 8000 } );
    //cy.wait("@getReactions", { timeout: 8000 } );
    
    // Check there are no banned reactions
    cy.contains('Reactions').should("be.visible");
    cy.contains('Reactions').click();
    cy.contains("No Ban Items");
    cy.get('[data-cy="banlist-table"]').find("tr").should("have.length", 0);
  });
});
