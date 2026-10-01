// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Test the drawing page", { browser: 'electron' }, () => {
    // describe("Site selectivity Page clipboard test", () => {
    beforeEach(() => {
        cy.viewport("macbook-11");
        cy.visit("/drawing");

    });

    it.skip("Test Canonicalization", function () {
        // Enter the reactants in the target box
        cy.get('[data-cy="draw-enter-smiles"]').type("C1=CC(=C(C=C1F)F)C(CN2C=NC=N2)(CN3C=NC=N3)O");

        // Click Canonicalization button
        cy.get('[data-cy="draw-canonicalize-btn"]').click();
        //cy.wait(2000);

        // Check the SMILES string has changed
        cy.contains('OC(Cn1cncn1)(Cn1cncn1)c1ccc(F)cc1F');
        //cy.get('.v-field__input').contains('OC(Cn1cncn1)(Cn1cncn1)c1ccc(F)cc1F');
    });

    it("Test Drawing button", function () {
        // Enter the reactants in the target box
        cy.get('[data-cy="component-draw-btn"]') //wait for the button to appear
        cy.get('[data-cy="component-draw-btn"]').click(); //click button and bring up the draw window
        cy.wait(2000);
        cy.get('[data-cy="ketcher-iframe"]').should('be.visible'); //wait until iframe is loaded
        cy.get('[data-cy="ketcher-iframe"]'); //Select the iframe

        cy.frameLoaded('[data-cy="ketcher-iframe"]');  // Load the iframe
        //cy.iframe().should('not.be.empty');
        cy.iframe().find('button').contains('Benzene').click();  //Select Benzene ring button
        cy.iframe().click(100,100); //Click on canvas to paste in Benzene ring
        //cy.contains('c1ccccc1');
        cy.get('[data-cy="ketcher-Done-button"]').click();  //Click on the done buttom
        cy.wait(2000);
        // Ketcher should now pass the smiles back to ASKCOS and draw the ring structue on screen
        // This does  not seem to be working as when click Done, the smiles are not passed back to 
        // ASKCOS. Need to work on this some more
        //cy.reload();
        //cy.contains('c1ccccc1');

        // Check the SMILES string has changed
        //cy.contains('OC(Cn1cncn1)(Cn1cncn1)c1ccc(F)cc1F');
        //cy.get('.v-field__input').contains('OC(Cn1cncn1)(Cn1cncn1)c1ccc(F)cc1F');
    });

});
