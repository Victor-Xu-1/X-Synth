// type definitions for Cypress object "cy"
/// <reference types="cypress" />
import 'cypress-file-upload';

describe("Solvent Screening Page", () => {
    beforeEach(() => {
        // Remove the downloads folder and all files in it.
        // Folder gets created when a file is saved to it
        cy.task('deleteFolder', 'cypress/downloads/')
        cy.viewport("macbook-11");
        cy.visit("/solprop?tab=solscreen");
    });

    after(() => {
        
    });

    it("Solvent Screening Solute Input", () => {
        //input for solute
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
    });

    it("Solvent Screening Solute Prediction, solvent set 1", () => {
        //input for solute
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
        cy.get('[data-cy="solscreen-submit"]').click(); // Should get 16 answers
        // Wait for process to finish, its slow
        cy.waitCelery();
        // Select to show all items per page
        cy.get('[data-cy="solscreen-table"] > .v-data-table-footer > .v-data-table-footer__items-per-page > .v-input > .v-input__control > .v-field > .v-field__append-inner').click();
        cy.contains('.v-overlay__content .v-list-item', 'All').click();
        cy.get('[data-cy="solscreen-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are not exactly 17 rows
                expect(row.length).to.have.eq(17);
            })
        // Clear Results
        cy.get('[data-cy="solscreen-clear"]').click();
        cy.get('.v-card-actions > .text-primary > .v-btn__content').click();
    });

    it("Solvent Screening Solute Prediction, solvent set 2", () => {
        //input for solute
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
        cy.get('[data-cy="solscreen-solsets"]').click();
        // Select solvent set 2
        cy.contains('.v-overlay__content .v-list-item', 'Set 2').click();
        cy.get('[data-cy="solscreen-submit"]').click(); // Should get 11 or 12 answers
        // Wait for process to finish, its slow
        cy.waitCelery();
        // Select to show all items per page
        cy.get('[data-cy="solscreen-table"] > .v-data-table-footer > .v-data-table-footer__items-per-page > .v-input > .v-input__control > .v-field > .v-field__append-inner').click();
        cy.contains('.v-overlay__content .v-list-item', 'All').click();
        cy.get('[data-cy="solscreen-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are more than 11 or 12 rows
                // this varies so can't use exact numbers, but it will be less than 13
                expect(row.length).to.be.lessThan(13)
            })
        // Clear Results
        cy.get('[data-cy="solscreen-clear"]').click();
        cy.get('.v-card-actions > .text-primary > .v-btn__content').click();
    });

    it("Solvent Screening Solute Prediction, create & run custom solvent set", () => {
        // Save set one as a custom set, run it, then delete it.
        //input for solute
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
        cy.get('[data-cy="solscreen-solsets"]').click();
        // Select custom set
        cy.contains('.v-overlay__content .v-list-item', 'custom').click();
        cy.get('.v-window-item--active > .v-container > :nth-child(1) > .v-col-md-12 > .v-sheet > .v-form > [justify-start=""] > .v-col > :nth-child(3) > .v-btn__content').click();
        cy.get('[data-cy="solscreen-name-solv-set"]')
            .find('input')
            .clear('m');
        cy.get('[data-cy="solscreen-name-solv-set"]')
            .find('input')
            .type('Cypress_test');
        // Check the naming is correct
        cy.get('[data-cy="solscreen-name-solv-set"]')
            .find('input')
            .should('have.value', 'Cypress_test');
        // Save the solvent set, in this case its a copy of set 1
        cy.get('[data-cy="solscreen-custom-solv-set-save"]').click();
        cy.get('[data-cy="solscreen-submit"]').click();
        cy.waitCelery();
        // Select to show all items per page
        cy.get('[data-cy="solscreen-table"] > .v-data-table-footer > .v-data-table-footer__items-per-page > .v-input > .v-input__control > .v-field > .v-field__append-inner').click();
        cy.contains('.v-overlay__content .v-list-item', 'All').click();
        cy.get('[data-cy="solscreen-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are not 17 rows (same as solvent set 1)
                expect(row.length).to.have.eq(17);
            })
        // Delete the custom set just made
        cy.get('[data-cy="solscreen-custom-solv-set-delete"]').click();
        
        // Clear Results
        cy.get('[data-cy="solscreen-clear"]').click();
        cy.get('.v-card-actions > .text-primary > .v-btn__content').click();
    });

    it("Solvent Screening Solute Prediction, sort by SMILES and solubility 298", () => {
        //input for solute
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
        cy.get('[data-cy="solscreen-submit"]').click();
        // Wait for the celery tasks to finish
        cy.waitCelery();
        // Select to show all items per page
        cy.get('[data-cy="solscreen-table"] > .v-data-table-footer > .v-data-table-footer__items-per-page > .v-input > .v-input__control > .v-field > .v-field__append-inner').click();
        cy.contains('.v-overlay__content .v-list-item', 'All').click();
        cy.get('[data-cy="solscreen-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are not 17 rows
                expect(row.length).to.have.eq(17);
            })
        // Sort by SMILES. Check first Smiles entry, first row, second column, should be O
        cy.get('tbody > :nth-child(1) > :nth-child(2)').should('contain', 'O');
        // Change the sort order
        cy.get('[data-cy="solscreen-table"] > .v-table__wrapper > table > thead > tr > :nth-child(2) > .v-data-table-header__content > .mdi-arrow-up').click();
        // Check first Smiles entry, should be C1CCOC1 after sorting
        cy.get('tbody > :nth-child(1) > :nth-child(2)').should('contain', 'C1CCOC1');

        // Sort by Solubility298. Check first Solubility entry, should be 498
        cy.get('tbody > :nth-child(1) > :nth-child(3)').should('contain', '498');
        // Change the sort order  
        cy.get('[data-cy="solscreen-table"] > .v-table__wrapper > table > thead > tr > :nth-child(3) > .v-data-table-header__content > .mdi-arrow-up').click();
        // Check first Smiles entry, should be 0.587 or not 498
        cy.get('tbody > :nth-child(1) > :nth-child(3)').should('not.contain', '498');

        // Clear Results
        cy.get('[data-cy="solscreen-clear"]').click();
        cy.get('.v-card-actions > .text-primary > .v-btn__content').click();
    });

    it("Change Calculation Method between Method 1 & Method 2", () => {
        //input for solute & run a prediction
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
        cy.get('[data-cy="solscreen-submit"]').click();
        // Wait for process to finish, its slow
        cy.waitCelery();

        //Check the information returned is correct
        cy.get('[data-cy="solscreen-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are more than 11 rows, not showing all results
                expect(row.length).to.have.eq(11);
            })
        // Check that Calculation Method is set 
        cy.get('[data-cy="solscreen-calc-method"]')
            .find('input')
            .should('have.value', 'Method 1');
        cy.get('[data-cy="solscreen-table"]').filter(':contains("Method 1")');
        // Change from Method 1 to Method 2
        cy.get('[data-cy="solscreen-calc-method"]').click();
        cy.contains('.v-overlay__content .v-list-item', 'Method 2').click();

        //Check Calculation Method has changed to Method 2
        cy.get('[data-cy="solscreen-calc-method"]')
            .find('input')
            .should('have.value', 'Method 2');
        cy.get('[data-cy="solscreen-table"]').filter(':contains("Method 2")');
        
        // Clear Results
        cy.get('[data-cy="solscreen-clear"]').click();
        cy.get('.v-card-actions > .text-primary > .v-btn__content').click();
    });
    it("Change units between log10 (mol/L) and mg/ml", () => {
        //input for solute
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
        cy.get('[data-cy="solscreen-submit"]').click(); // Should get 16 answers
        // Wait for process to finish, its slow
        cy.waitCelery();

        //Check the information returned is correct
        cy.get('[data-cy="solscreen-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are more than 11 rows, not showing all results
                expect(row.length).to.have.eq(11);
            })
        // Check that units mg/mL is set
        cy.get('[data-cy="solscreen-units"]')
            .find('input')
            .should('have.value', 'mg/mL');
        // Check the table as the units are only listed in the headers
        cy.get('[data-cy="solscreen-table"]').filter(':contains("mg/mL")');

        // Change from mg/mL to log10(mol/L)
        cy.get('[data-cy="solscreen-units"]').click();
        cy.contains('.v-overlay__content .v-list-item', 'log10(mol/L)').click();

        //check temp chart is displayed
        cy.get('[data-cy="solscreen-units"]')
            .find('input')
            .should('have.value', 'log10(mol/L)');
        // Check the table as the units are only listed in the headers 
        cy.get('[data-cy="solscreen-table"]').filter(':contains("log10(mol/L)")');

        // Clear Results & clean up
        cy.get('[data-cy="solscreen-clear"]').click();
        cy.get('.v-card-actions > .text-primary > .v-btn__content').click();

    });
    it("Change X-axis between solvent and temperature", () => {
        //input for solute
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
        cy.get('[data-cy="solscreen-submit"]').click(); // Should get 16 answers
        // Wait for process to finish, its slow
        cy.waitCelery();

        //Check the information returned is correct
        cy.get('[data-cy="solscreen-table"]')
            .find("tr")
            .then((row) => {
                cy.log(row.length); // The row count
                // Throw and error if there are more than 11 rows, not showing all results
                expect(row.length).to.have.eq(11);
            })
        // Check that solvent is set and solvent chart is displayed
        cy.get('[data-cy="solscreen-x-axis"]')
            .find('input')
            .should('have.value', 'solvent');
        cy.get('[data-cy="solscreen-chart-solvent"]').should('be.visible');

        // Change from solvent to temp 
        cy.get('[data-cy="solscreen-x-axis"]').click();
        cy.contains('.v-overlay__content .v-list-item', 'temperature').click();

        //check temp chart is displayed
        cy.get('[data-cy="solscreen-x-axis"]')
            .find('input')
            .should('have.value', 'temperature');
        cy.get('[data-cy="solscreen-chart-temp"]').should('be.visible');


        // Clear Results
        cy.get('[data-cy="solscreen-clear"]').click();
        cy.get('.v-card-actions > .text-primary > .v-btn__content').click();

    });

    it("Download CSV", () => {
        //input for solute
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
        cy.get('[data-cy="solscreen-submit"]').click(); // Should get 16 answers
        // Wait for process to finish, its slow
        cy.waitCelery();

        //click downloads and JSON file
        cy.get('[data-cy="solscreen-download"]').click();
        cy.get('[data-cy="solscreen-download-csv"]').click();

        // Check the file exists
        cy.readFile('cypress/downloads/askcos_solubility_export.csv'); //no need for a should here
        // Delete newly created file
        cy.task('deleteFolder', 'cypress/downloads/askcos_solubility_export.csv');
    });

    it("Download JSON", () => {
        //input for solute
        cy.get('[data-cy="solscreen-solute"]').type("CC(=O)O");
        cy.get('[data-cy="solscreen-solute"]')
            .find('input')
            .should('have.value', 'CC(=O)O');
        cy.get('[data-cy="solscreen-submit"]').click(); // Should get 16 answers
        // Wait for process to finish, its slow
        cy.waitCelery();
        //click downloads and JSON file
        cy.get('[data-cy="solscreen-download"]').click();
        cy.get('[data-cy="solscreen-download-json"]').click();
        // Check the file exists
        cy.readFile('cypress/downloads/askcos_solubility_export.json'); //no need for a should here
        // Delete newly created file
        cy.task('deleteFolder', 'cypress/downloads/askcos_solubility_export.json');
    });
});