// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("QM descriptor tests", () => {
    beforeEach(() => {
        // Remove the downloads folder and all files in it.
        // Folder gets created when a file is saved to it
        cy.task('deleteFolder', 'cypress/downloads/')
        cy.viewport("macbook-11");
        // No login is needed to use QM
        cy.visit("/molcom");
    });

    // afterEach(() => {
    //     cy.task('deleteFolder', 'cypress/downloads/qm.json');
    //     cy.get('[data-cy="molcom-clear-button"]').click();
    //     //Once the table is cleared, there is only 1 column present
    //     // cy.get('[data-cy="molcom-table"]').should('not.exist');
    // });

    it("Input and submit", () => {
        cy.get('[data-cy="molcom-smiles-input"]').type("C1CCCCCCC1");
        cy.get('[data-cy="molcom-submit-button"]').click();
        cy.get('[data-cy="molcom-submit-button"]').click();
        cy.get('[data-cy="molcom-table"]')
            .find("tr")
            .then((column) => {
                cy.log(column.length); // The column count
                // Throw and error if there is more than 1 column
                expect(column.length).to.have.eq(3);
            });
    });

    it("Input more scores and submit", () => {
        cy.get('[data-cy="molcom-smiles-input"]').type("C1CCCCCCC1");
        cy.get('[data-cy="molcom-complexity-metrics"]').click()
        cy.get('.v-list-item-title').contains('Boettcher').click();
        cy.get('.v-list-item-title').contains('Coley').click();
        // cy.get('.v-list-item-title').contains('Kier').click();

        cy.get('[data-cy="molcom-submit-button"]').click();
        cy.get('[data-cy="molcom-table"]')
            .find("td")
            .then((column) => {
                cy.log(column.length); // The column count
                // Throw and error if there is more than 1 column
                expect(column.length).to.have.eq(1);
            });
        cy.get('[data-cy="molcom-table"]').find('td').should('have.length', 5);
    });

    it("Download scores JSON & CSV", () => {
        cy.get('[data-cy="molcom-smiles-input"]').type("C1CCCCCCC1");
        cy.get('[data-cy="molcom-submit-button"]').click();
        cy.get('[data-cy="molcom-download"]').click()
        cy.contains("Download JSON").click()
        cy.readFile("cypress/downloads/molcom.json")

        cy.get('[data-cy="molcom-download"]').click()
        cy.contains("Download CSV").click()
        cy.readFile("cypress/downloads/molcom.csv")
    });

});