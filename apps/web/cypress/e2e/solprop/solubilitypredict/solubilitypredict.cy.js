// type definitions for Cypress object "cy"
/// <reference types="cypress" />
import 'cypress-file-upload';
//import fs from 'fs';

describe("Solubility Predict Page", () => {
  beforeEach(() => {
    // Remove the downloads folder and all files in it.
    // Folder gets created when a file is saved to it
    cy.task('deleteFolder', 'cypress/downloads/')
    cy.viewport("macbook-11");
    cy.visit("/solprop?tab=solpred");
  });

  after(() => {
    // Delete last remaining download test file from download directory
    cy.task('deleteFolder', 'cypress/downloads/askcos_solubility_export.json');
  });

  it("Solubility Prediction Solute Input", () => {
    //input for solute
    cy.get('[data-cy="solpred-solute"]').type("CC(=O)O");
    cy.get('[data-cy="solpred-solute"]')
      .find('input')
      .should('have.value', 'CC(=O)O');
  });

  it("Solubility Prediction Solvent Input", () => {
    //input for solvent
    cy.get('[data-cy="solpred-solvent"]').type("CCO");
    cy.get('[data-cy="solpred-solvent"]')
      .find('input')
      .should('have.value', 'CCO');
  });

  it("Solubility Prediction Temp Input", () => {
    // Clear temp field
    cy.get('[data-cy="solpred-temp"]')
      .find('input')
      .clear('value', '298');
    // Enter the test temp
    cy.get('[data-cy="solpred-temp"]').type('298');
    cy.get('[data-cy="solpred-temp"]')
      .find('input')
      .should('have.value', '298');
  });

  it("Solubility Prediciton Get Result using the defaults - SolProp", () => {
    // Defaults here are Solubility(T) and Solubility(298)
    //input for solute
    cy.get('[data-cy="solpred-solute"]').type("CC(=O)O");
    cy.get('[data-cy="solpred-solute"]')
      .find('input')
      .should('have.value', 'CC(=O)O');
    //input for solvent
    cy.get('[data-cy="solpred-solvent"]').type("CCO");
    cy.get('[data-cy="solpred-solvent"]')
      .find('input')
      .should('have.value', 'CCO');
    cy.get('[data-cy="model-selection"]').click()
    cy.get('.v-overlay__content > .v-list').contains('SolProp').click()
    //click submit button
    cy.get('[data-cy="solpred-submit"]').click();
    // Check for results, should be 2 rows (inclding header) and 6 ccolumns
    cy.get('[data-cy="solpred-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        // Throw and error if there are more than 2 rows
        expect(row.length).to.have.eq(2);
      })
    cy.get('[data-cy="solpred-table"]')
      .find("td")
      .then((column) => {
        cy.log(column.length); // The column count
        // Throw and error if there are not 11 columns
        expect(column.length).to.have.eq(15);
      })
    cy.get('[data-cy="solpred-clear-results"]').click();
  });

  it("Solubility Prediciton Get Result using the defaults - FastSolv", () => {
    // Defaults here are Solubility(T) and Solubility(298)
    //input for solute
    cy.get('[data-cy="solpred-solute"]').type("CC(=O)O");
    cy.get('[data-cy="solpred-solute"]')
      .find('input')
      .should('have.value', 'CC(=O)O');
    //input for solvent
    cy.get('[data-cy="solpred-solvent"]').type("CCO");
    cy.get('[data-cy="solpred-solvent"]')
      .find('input')
      .should('have.value', 'CCO');
    cy.get('[data-cy="model-selection"]').click()
    cy.get('.v-overlay__content > .v-list').contains('FastSolv').click()
    //click submit button
    cy.get('[data-cy="solpred-submit"]').click();
    // Check for results, should be 2 rows (inclding header) and 6 ccolumns
    cy.get('[data-cy="solpred-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        // Throw and error if there are more than 2 rows
        expect(row.length).to.have.eq(2);
      })
    cy.get('[data-cy="solpred-table"]')
      .find("td")
      .then((column) => {
        cy.log(column.length); // The column count
        // Throw and error if there are not 11 columns
        expect(column.length).to.have.eq(15);
      })
    cy.get('[data-cy="solpred-clear-results"]').click();
  });

    it("Solubility Prediciton Get Result using the defaults - Fusion Cycle", () => {
    // Defaults here are Solubility(T) and Solubility(298)
    //input for solute
    cy.get('[data-cy="solpred-solute"]').type("CC(=O)O");
    cy.get('[data-cy="solpred-solute"]')
      .find('input')
      .should('have.value', 'CC(=O)O');
    //input for solvent
    cy.get('[data-cy="solpred-solvent"]').type("CCO");
    cy.get('[data-cy="solpred-solvent"]')
      .find('input')
      .should('have.value', 'CCO');
    cy.get('[data-cy="model-selection"]').click()
    cy.get('.v-overlay__content > .v-list').contains('Fusion Cycle').click()
    //click submit button
    cy.get('[data-cy="solpred-submit"]').click();
    // Fusion Cycle is slower than SolProp/FastSolv; wait for the celery task to finish
    cy.waitCelery();
    // Check for results, should be 2 rows (inclding header) and 6 ccolumns
    cy.get('[data-cy="solpred-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        // Throw and error if there are more than 2 rows
        expect(row.length).to.have.eq(2);
      })
    cy.get('[data-cy="solpred-table"]')
      .find("td")
      .then((column) => {
        cy.log(column.length); // The column count
        // Throw and error if there are not 11 columns
        expect(column.length).to.have.eq(15);
      })
    cy.get('[data-cy="solpred-clear-results"]').click();
  });

  it("Solubility Prediciton Get Result using all columns", () => {
    // Defaults here are Solubility(T) and Solubility(298)
    //input for solute
    cy.get('[data-cy="solpred-solute"]').type("CC(=O)O");
    cy.get('[data-cy="solpred-solute"]')
      .find('input')
      .should('have.value', 'CC(=O)O');
    //input for solvent
    cy.get('[data-cy="solpred-solvent"]').type("CCO");
    cy.get('[data-cy="solpred-solvent"]')
      .find('input')
      .should('have.value', 'CCO');
    // Input the temp
    cy.get('[data-cy="solpred-temp"]')  // Clear temp field
      .find('input')
      .clear('value', '298');
    // Enter the test temp
    cy.get('[data-cy="solpred-temp"]').type('298');
    cy.get('[data-cy="solpred-temp"]')
      .find('input')
      .should('have.value', '298');

    cy.get('[data-cy="model-selection"]').click()
    cy.get('.v-overlay__content > .v-list').contains('FastSolv').click()
    //click submit button
    cy.get('[data-cy="solpred-submit"]').click();
    cy.waitCelery();  // This is causing the test to fail,
    cy.get('[data-cy="solpred-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        // Throw and error if there are more than 2 rows
        expect(row.length).to.have.eq(2);
      })
    cy.get('[data-cy="solpred-table"]')
      .find("td")
      .then((column) => {
        cy.log(column.length); // The column count
        // Throw and error if there are not 11 columns
        expect(column.length).to.have.eq(15);
      })
    // Now select all solubility columns
    cy.get('[data-cy="solpred-select-columns"]').click();
    cy.get('[data-cy="solpred-select-all"]').click();

    // Check for results, should be 2 rows (including header) and 6 ccolumns
    cy.get('[data-cy="solpred-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        // Throw and error if there are more than 2 rows
        expect(row.length).to.have.eq(2);
      })
    cy.get('[data-cy="solpred-table"]')
      .find("td")
      .then((column) => {
        cy.log(column.length); // The column count
        // Throw and error if there are more than 6 columns
        expect(column.length).to.be.gt(6);
      })
    cy.get('[data-cy="solpred-clear-results"]').click();
  });

  it("Can Run Batch with CSV", () => {
    cy.get('[data-cy="model-selection"]').click();
    cy.get('.v-overlay__content > .v-list').contains('FastSolv').click();

    cy.fixture('solubility_upload_test.csv', null).as('solpred-file-upload-fixture1');
    //click run batch button
    cy.get('[data-cy="solpred-run-batch"]').click();
    cy.get('[data-cy="solpred-file-upload"]').click();

    // Populate the select file popup
    cy.get('[data-cy="solpred-file-upload"]').should("be.visible");
    cy.get('input[type=file]').selectFile('@solpred-file-upload-fixture1', { force: true });
    cy.get('[data-cy="solpred-file-upload-upload"]').click();
    cy.get('[data-cy="solpred-table"]').should('be.visible', { timeout: 7000 });
    cy.get('[data-cy="solpred-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        // Throw and error if there are more than 4 rows of data and header row
        expect(row.length).to.have.eq(5);
      });
  });
  it("Can Run Batch with JSON", () => {
    cy.get('[data-cy="model-selection"]').click();
    cy.get('.v-overlay__content > .v-list').contains('FastSolv').click();

    cy.fixture('solubility_upload_test.json', null).as('solpred-file-upload-fixture2');
    //click run batch button
    cy.get('[data-cy="solpred-run-batch"]').click();
    cy.get('[data-cy="solpred-file-upload"]').click();

    // Populate the select file popup
    cy.get('[data-cy="solpred-file-upload"]').should("be.visible");
    cy.get('input[type=file]').selectFile('@solpred-file-upload-fixture2', { force: true }); //Can't read the file, first argument is not readable
    cy.get('[data-cy="solpred-file-upload-upload"]').click(); //Error here to do wth how the file is read, investigating
    cy.get('[data-cy="solpred-table"]').should('be.visible', { timeout: 5000 })
    cy.get('[data-cy="solpred-table"]')
      .find("tr")
      .then((row) => {
        cy.log(row.length); // The row count
        // Throw and error if there are more than 4 rows of data and header row
        expect(row.length).to.have.eq(3);
      });
  });

  it("Download CSV", () => {
    //input for solute
    cy.get('[data-cy="solpred-solute"]').type("CC(=O)O");
    //input for solvent
    cy.get('[data-cy="solpred-solvent"]').type("CCO");
    cy.get('[data-cy="model-selection"]').click();
    cy.get('.v-overlay__content > .v-list').contains('FastSolv').click();
    //click submit button
    cy.get('[data-cy="solpred-submit"]').click();
    cy.get('[data-cy="solpred-download"]').click();
    cy.get('[data-cy="solpred-download-csv"]').click();
    // Check the file exists
    cy.readFile('cypress/downloads/askcos_solubility_export.csv');
  });

  it("Download JSON", () => {
    //input for solute
    cy.get('[data-cy="solpred-solute"]').type("CC(=O)O");
    //input for solvent
    cy.get('[data-cy="solpred-solvent"]').type("CCO");
    cy.get('[data-cy="model-selection"]').click();
    cy.get('.v-overlay__content > .v-list').contains('FastSolv').click();

    //click submit button
    cy.get('[data-cy="solpred-submit"]').click();
    //click downloads and JSON file
    cy.get('[data-cy="solpred-download"]').click();
    cy.get('[data-cy="solpred-download-json"]').click();
    // Check the file exists
    cy.readFile('cypress/downloads/askcos_solubility_export.json'); //no need for a should here
  });
});
