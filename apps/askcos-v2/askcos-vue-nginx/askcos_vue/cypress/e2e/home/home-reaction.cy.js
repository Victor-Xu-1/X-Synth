// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("synon Homepage", () => {
  // Create username and password global variables
  let username;
  let password;

  before(() => {
    // Set username and password
    cy.getUserCredentials('validUser').then((credentials) => {
      username = credentials.username;
      password = credentials.password;
    });
  });
  beforeEach(() => {
    cy.viewport("macbook-11");
    //const username = Cypress.env('validUser').username
    //const password = Cypress.env('validUser').password
    cy.login(username, password);
    cy.visit("/");
  });

  it("Test Fast Filter Score", function () {
    cy.get('[placeholder="SMILES"]').type(
      "CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C>>CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1"
    );
    cy.get('[data-cy="home-fast-filter-score"]').click();
    cy.contains("Fast Filter Score").parent().contains("1.0");
  });

  it("Test Generate Atom Mapping Indigo", function () {
    cy.get('[placeholder="SMILES"]').type(
      "CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C>>CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1"
    );
    cy.get('[data-cy="home-generate-atom-mapping"]').click();
    //cy.contains(
    //  "[CH3:1][C:2]([c:4]1[cH:12][c:11]2[c:7]([nH:8][cH:9][cH:10]2)[cH:6][cH:5]1)=[O:3].[CH3:13][C:14]([O:17][C:18](O[C:18]([O:17][C:14]([CH3:16])([CH3:15])[CH3:13])=[O:19])=[O:19])([CH3:16])[CH3:15]>>[CH3:1][C:2]([c:4]1[cH:12][c:11]2[cH:10][cH:9][n:8]([C:18]([O:17][C:14]([CH3:16])([CH3:15])[CH3:13])=[O:19])[c:7]2[cH:6][cH:5]1)=[O:3]"
    //);
    // Checking for half the Atom mapped SMILES string, if use the full string then there is a problem, some
    // characters may need to be escaped out.
    cy.contains(
      "SMILES: CC(OC(O[C:12](=O)[O:14][C:15](C)(C)[CH3:16])=[O:13])([CH3:17])[CH3:18].[CH3:1][C:2](=[O:3])[c:4]1[cH:5][cH:6][c:7]2[c:8]([cH:9][cH:10][nH:11]2)[cH:19]");
  });

  it("Test Forward synthesis", function () {
    cy.get('[placeholder="SMILES"]').type(
      "CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C>>CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1"
    );
    cy.get('[data-cy="home-forward-synthesis"]')
      .invoke("removeAttr", "target")
      .click();
    cy.url().should("include", "forward&rxnsmiles=");
  });

  it("Test Condition Recommendation", function () {
    cy.get('[placeholder="SMILES"]').type(
      "CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C>>CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1"
    );
    cy.get('[data-cy="home-predict-condition"]')
      .invoke("removeAttr", "target")
      .click();
    cy.url().should("include", "context&rxnsmiles=");
    // Check to see if the table appears, if it does then the
    // Get Reaction Score, this shows a successful prediction 
    cy.get('[data-cy="cond-rec-get-reaction-score"]').should('be.visible');
  });

  it("Test Impurity Prediction", function () {
    cy.get('[placeholder="SMILES"]').type(
      "CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C>>CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1"
    );
    cy.get('[data-cy="home-predict-impurities"]')
      .invoke("removeAttr", "target")
      .click();
    cy.url().should("include", "impurity&rxnsmiles=");
    cy.waitCelery()
      .get('[data-cy="impurity-prediction-table"]')
      .contains("Predicted Impurities");
  });

  it("Test Regioselectivity", function () {
    cy.get('[placeholder="SMILES"]').type(
      "CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C>>CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1"
    );
    cy.get('[data-cy="home-predict-regioselectivity"]')
      .invoke("removeAttr", "target")
      .click();
    cy.url().should("include", "selectivity&rxnsmiles=");
  });

  it("Test Classify Reaction", function () {
    cy.get('[placeholder="SMILES"]').type(
      "CC(=O)c1ccc2[nH]ccc2c1.CC(C)(C)OC(=O)OC(=O)OC(C)(C)C>>CC(=O)c1ccc2c(ccn2C(=O)OC(C)(C)C)c1"
    );
    cy.get('[data-cy="home-classify-reaction"]').click();
    cy.contains("Reaction Name (Lvl 1)");
  });
});
