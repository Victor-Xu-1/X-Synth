// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("QM descriptor tests", () => {
    beforeEach(() => {
        // Remove the downloads folder and all files in it.
        // Folder gets created when a file is saved to it
        cy.task('deleteFolder', 'cypress/downloads/')
        cy.viewport("macbook-11");
        // No login is needed to use QM
        cy.visit("/qm");
    });

    afterEach(() => {
        cy.task('deleteFolder', 'cypress/downloads/qm.json');
        cy.get('[data-cy="qm-clear-button"]').click();
        //Once the table is cleared, there is only 1 column present
        cy.get('[data-cy="qm-table"]')
            .find("td")
            .then((column) => {
                cy.log(column.length); // The column count
                // Throw and error if there is more than 1 column
                expect(column.length).to.have.eq(1);
            });
    });

    it("Test QM Prediction on single input and clear", () => {
        cy.get('[data-cy="qm-smiles-input"]').type("C1CCCCCCC1");
        //cy.get('[data-cy="qm-smiles-input"]').type("CC(=O)O");
        cy.get('[data-cy="qm-submit-button"]').click();
        //cy.get('[data-cy="qm-table"]', { timeout: 10000 }).should('be.visible');

        cy.get('[data-cy="qm-table"]').contains("npa charge (e)");

        // Check for only 1 row of data (2 including the header)
        cy.get('[data-cy="qm-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are more than 2 rows
                expect(row.length).to.have.eq(2);
            });

        // Check if the results table has a cell containing npa
        // given there is only 1 row of data, don't need to search for 
        // anyting else
        cy.get('[data-cy="qm-table"]').find("tr").contains('npa').should('exist');
    });

    it("Test QM Prediction, clear button and select all qm parameters ", () => {
        cy.get('[data-cy="qm-smiles-input"]').type("C1CCCCCCC1");
        cy.get('[data-cy="qm-submit-button"]').click();
        cy.get('[data-cy="qm-table"]').contains("npa charge (e)");

        // Check for 5 columns of data (6 including the header)
        cy.get('[data-cy="qm-table"]')
            .find("td")
            .then((column) => {
                cy.log(column.length); // The column count
                // Throw and error if there are more than 6 column
                expect(column.length).to.have.eq(7);
            })

        // Check if the results table has a cell containing npa but not bond
        // given there is only 1 row of data, don't need to search for 
        // anything else
        cy.get('[data-cy="qm-table"]').find("tr").contains('npa').should('exist');
        cy.get('[data-cy="qm-table"]').find("tr").contains('bond').should('not.exist');

        cy.get('[data-cy="qm-select-columns"]').click();
        cy.get('[data-cy="qm-select-all"]').click();
        // Check for more than 6 columns of data (6 is the min,, only NPA checked)
        cy.get('[data-cy="qm-table"]')
            .find("td")
            .then((column) => {
                //cy.log(column.length); // The column count
                // Throw and error if there are no more than 6 columns
                expect(column.length).gt(6);
            })

        // Check if the results table has a cell containing Cypress
        // given there is only 1 row of data, don't need to search for 
        // anyting else
        cy.get('[data-cy="qm-table"]').find("tr").contains('npa').should('exist');
        cy.get('[data-cy="qm-table"]').find("tr").contains('bond').should('exist');
    });

    it("Test QM Prediction save as CSV", () => {
        cy.get('[data-cy="qm-smiles-input"]').type("C1CCCCCCC1");
        cy.get('[data-cy="qm-submit-button"]').click();
        // Check for only 1 row of data (2 including the header)
        cy.get('[data-cy="qm-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are more than 2 rows
                expect(row.length).to.have.eq(2);
            });
        
        // Save data in CSV format
        cy.get('[data-cy="qm-download"]').click();
        cy.get('[data-cy="qm-download-csv"]').click();
        // Test file was successfully saved somehow
        // will pass if the file does not exist
        cy.readFile('cypress/downloads/qm.csv');
    });
    it("Test QM Prediction save as JSON", () => {
        cy.get('[data-cy="qm-smiles-input"]').type("C1CCCCCCC1");
        cy.get('[data-cy="qm-submit-button"]').click();
        // Check for only 1 row of data (2 including the header)
        cy.get('[data-cy="qm-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are more than 2 rows
                expect(row.length).to.have.eq(2);
            });
        // Save data in JSON format
        cy.get('[data-cy="qm-download"]').click();
        cy.get('[data-cy="qm-download-json"]').click();
        // Test file was successfully saved somehow
        // will pass if the file does not exist
        cy.readFile('cypress/downloads/qm.json');
    });


    it("Test QM Prediction, with 2 inputs & clear button", () => {
        cy.get('[data-cy="qm-smiles-input"]').type("C1CCCCCCC1");
        cy.get('[data-cy="qm-submit-button"]').click();
        // Clear text field or new SMILES gets appended to previous one.
        cy.get('[data-cy="qm-smiles-input"]').clear("C1CCCCCCC1");
        cy.get('[data-cy="qm-smiles-input"]').type("CC(=O)O");
        cy.get('[data-cy="qm-submit-button"]').click();
        cy.get('[data-cy="qm-table"]').contains("npa charge (e)");

        // Check for 2rows of data (3 including the header)
        cy.get('[data-cy="qm-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are more than 3 rows
                expect(row.length).to.have.eq(3);
            })
    });
});