// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Buyable Compounds Page", () => {
  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.visit("/buyables");
    cy.intercept("GET", "/api/buyables/sources").as("getSource");
    cy.wait("@getSource");
  });

  it("Run a search for compounds", () => {
    //cy.get('[data-cy="buyables-smiles-input"]').type("c1ccccc1");
    cy.get('[placeholder="SMILES/SMARTS"]').type("c1ccccc1");
    cy.get('[data-cy="buyables-search-button"]').click();
    // Check for 4 or more rows of data (3 including the header)
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .then((row) => {
        //row.length will give the row count
        //cy.log(row.length);
        // Throw and error if there are more than 2 rows
        expect(row.length).to.gte(3);
      });
  });

  it("Change similarity threshold to 0.25 and run a search", () => {
    cy.get('[data-cy="similarity-input-element"] input').clear();
    cy.get('[data-cy="similarity-input-element"] input').type("0.25");
    cy.get('[data-cy="similarity-input-element"] input').should(
      "have.value",
      "0.25",
    );
    // Run the prediciton and should have 11 values
    cy.get('[placeholder="SMILES/SMARTS"]').type("c1ccccc1");
    cy.get('[data-cy="buyables-search-button"]').click();
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .then((row) => {
        //row.length will give the row count
        //cy.log(row.length);
        // Throw and error if there are more than 2 rows
        expect(row.length).to.gte(10);
      });
  });

  it("Display 100 results", () => {
    // Ensure we can get 100 results before trying this test
    cy.get('[data-cy="result-input-element"] input').clear();
    cy.get('[data-cy="result-input-element"] input').type("100");
    cy.get('[data-cy="result-input-element"] input').should(
      "have.value",
      "100",
    );
    // Run the prediciton and should have more than 100 results
    // Changing the buyables to something more generic and reducing
    // the similarity score to get over 100 compounds
    cy.get('[placeholder="SMILES/SMARTS"]').type("CCC");
    cy.get('[data-cy="similarity-input-element"] input').clear();
    cy.get('[data-cy="similarity-input-element"] input').type("0.25");
    cy.get('[data-cy="similarity-input-element"] input').should(
      "have.value",
      "0.25",
    );
    cy.get('[data-cy="buyables-search-button"]').click();
    // Set page to show all results, should be 100 +1 for table headers
    /* ==== Generated with Cypress Studio ==== 
    cy.get('.v-field__append-inner > .mdi-menu-down').click();
    cy.get('.v-overlay__content > .v-list > :nth-child(5)').click();
    /* ==== End Cypress Studio ==== */
    // Open the dropdown by clicking on it
    cy.get('[role="combobox"]').first().click();
    cy.get('[role="listbox"]').should('be.visible');
    cy.contains('[role="option"]', 'All').click();
    // Now count the rows and test
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .then((row) => {
        //row.length will give the row count
        //cy.log(row.length);
        //cy.log(cy.get('.v-data-table-footer__info'));
        // Throw and error if there are more than 2 rows
        expect(row.length).to.eq(101);
      });
  });

  it("Display 50 results", () => {
    // Ensure we can get 100 results before trying this test
    cy.get('[data-cy="result-input-element"] input').clear();
    cy.get('[data-cy="result-input-element"] input').type("50");
    cy.get('[data-cy="result-input-element"] input').should("have.value", "50");
    // Run the prediciton and should have more than
    cy.get('[placeholder="SMILES/SMARTS"]').type("CCC");
    cy.get('[data-cy="similarity-input-element"] input').clear();
    cy.get('[data-cy="similarity-input-element"] input').type("0.25");
    cy.get('[data-cy="similarity-input-element"] input').should(
      "have.value",
      "0.25",
    );
    cy.get('[data-cy="buyables-search-button"]').click();
    // Set page to show all results, should be 50 +1 for table headers
    /* ==== Generated with Cypress Studio ==== 
    cy.get(".v-field__append-inner > .mdi-menu-down").click();
    cy.get(".v-overlay__content > .v-list > :nth-child(6)").click();
    /* ==== End Cypress Studio ==== */
    cy.get('[role="combobox"]').first().click();
    cy.get('[role="listbox"]').should('be.visible');
    cy.contains('[role="option"]', '50').click();
    
    // Now count the rows and test
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .then((row) => {
        //row.length will give the row count
        //cy.log(row.length);
        cy.log(cy.get(".v-data-table-footer__info"));
        // Throw and error if there are more than 2 rows
        expect(row.length).to.eq(51);
      });
  });

  it("Do search only on a single buyables source, SA", () => {
    cy.get('[placeholder="SMILES/SMARTS"]').type("c1ccccc1");
    cy.get('[data-cy="buyables-select-sources"]').click();
    // Deselect the following sources, retain only SA
    cy.get(".v-list-item-title").contains("LN").click();
    cy.get(".v-list-item-title").contains("EM").click();
    cy.get(".v-list-item-title").contains("CB").click();
    cy.get(".v-list-item-title").contains("MC").click();
    // Run the buyables search
    cy.get('[data-cy="buyables-search-button"]').click();

    // Check for only 1 row of data (2 including the header)
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .then((row) => {
        // row.length will give the row count
        //cy.log(row.length);
        // Throw an error if there are more than 2 rows
        expect(row.length).to.have.eq(2);
      });
    // Check if the results table has a cell containing SA but not have a LN entry
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .find("td")
      .contains("SA")
      .should("exist");
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .find("td")
      .contains("LN")
      .should("not.exist");
  });

  it("Do search only on a single buyables source, LN", () => {
    cy.get('[placeholder="SMILES/SMARTS"]').type("c1ccccc1");
    cy.get('[data-cy="buyables-select-sources"]').click();
    // Deselect the following sources, retain only LN
    cy.get(".v-list-item-title").contains("MC").click();
    cy.get(".v-list-item-title").contains("EM").click();
    cy.get(".v-list-item-title").contains("CB").click();
    cy.get(".v-list-item-title").contains("SA").click();
    // Run the buyables search
    cy.get('[data-cy="buyables-search-button"]').click();

    // Check for only 1 row of data (2 including the header)
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .then((row) => {
        // row.length will give the row count
        //cy.log(row.length);
        // Throw an error if there are more than 2 rows
        expect(row.length).to.have.eq(2);
      });
    // Check if the results table has a cell containing SA but not have a LN entry
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .find("td")
      .contains("LN")
      .should("exist");
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .find("td")
      .contains("MC")
      .should("not.exist");
  });
  it("Do search only on a two buyables sources, EM & LA", () => {
    cy.get('[placeholder="SMILES/SMARTS"]').type("c1ccccc1");
    cy.get('[data-cy="buyables-select-sources"]').click();
    // Deselect the following sources, retain only SA
    cy.get(".v-list-item-title").contains("SA").click();
    cy.get(".v-list-item-title").contains("CB").click();
    cy.get(".v-list-item-title").contains("MC").click();
    // Run the buyables search
    cy.get('[data-cy="buyables-search-button"]').click();

    // Check for only 1 row of data (2 including the header)
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .then((row) => {
        // row.length will give the row count
        //cy.log(row.length);
        // Throw an error if there are more than 3 rows
        expect(row.length).to.have.eq(3);
      });
    // Check if the results table has a cell containing SA but not have a LN entry
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .find("td")
      .contains("LN")
      .should("exist");
    cy.get('[data-cy="buyables-table"]')
      .find("tr")
      .find("td")
      .contains("SA")
      .should("not.exist");
  });
});
