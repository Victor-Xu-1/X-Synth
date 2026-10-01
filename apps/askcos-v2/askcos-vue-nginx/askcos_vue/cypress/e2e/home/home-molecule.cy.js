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

  it("Test Canonicalization", function () {
    cy.waitResult()
    cy.get('[placeholder="SMILES"]').type(
      "C1=CC(=C(C=C1F)F)C(CN2C=NC=N2)(CN3C=NC=N3)O"
    );
    //cy.wait(1000);
    // Check the SMILES have been eneterd and allow the page to load.
    cy.contains("C1=CC(=C(C=C1F)F)C(CN2C=NC=N2)(CN3C=NC=N3)O");
    // Check page has been loaded as SCScore box option appears
    cy.get('.v-card-title').contains('SCScore');

    cy.get('[data-cy="home-structure-convert"]').click();
    cy.wait(1000);
    //cy.get('[data-cy="home-smiles-input-field"]')
    //  .find("input")
    //  .should("have.value", "OC(Cn1cncn1)(Cn1cncn1)c1ccc(F)cc1F");
    // Check the SMILES string has changed
    cy.get('.v-field__input').contains('OC(Cn1cncn1)(Cn1cncn1)c1ccc(F)cc1F');
  });

  it("Test Resolver", function () {
    cy.waitResult()
    cy.get('[data-cy="home-NIH-resolver"]').click();

    cy.wait(1000);
    cy.get('[placeholder="SMILES"]').type("aspirin");
    // Pause until the invalid SMILES warning pops up, this 
    // removes the wait and keeps lint happy
    cy.get('.v-img__error').should('exist');
    cy.wait(1000);
    cy.get('[data-cy="home-resolve-btn"]').click();
    // Wait until the screen updates as this will indicate the
    // result has been returned, removes tha wait
    cy.get('.v-card-title').contains('SCScore');

    cy.wait(1000);
    // Check that the page contains the SMILES for aspirin
    cy.contains("CC(=O)OC1=CC=CC=C1C(=O)O");

    // cy.get('[data-v-3bc2b283=""] > .v-responsive > .v-responsive__content').click()
    //cy.get('[data-cy="home-smiles-input-field"]')
    //  .find("input")
    //  .should("have.value", "CC(=O)OC1=CC=CC=C1C(=O)O");
    cy.get('.v-field__input').contains('CC(=O)OC1=CC=CC=C1C(=O)O');
  });

  it("Load previous results - View in IPP", function () {
    cy.waitResult();
    //cy.get('[data-cy="home-results-bar"').should("be.visible");
    //cy.get('[data-cy="results-view-ipp"]').eq(1).click()
    cy.get('[data-cy="results-view-ipp"]').contains('IPP').first().click()
    cy.url().should("include", "network?tab=IPP");
  });

  it("Load previous results - View Trees", function () {
    cy.waitResult();
    //cy.get('[data-cy="results-view-tree"]').eq(1).click();
    //cy.get('[data-cy="home-results-bar"').should("be.visible");
    cy.get('[data-cy="results-view-tree"]').contains('trees').first().click()
    cy.url().should("include", "network?tab=TE");
  });

  it("Load previous results - Delete", function () {
    cy.waitResult()
    cy.get('[data-cy="results-delete-single"]').eq(0).click()
  });

  it("Test SCscore", function () {
    cy.get('[placeholder="SMILES"]').type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="home-scscore"]').click();
    cy.contains("SCScore").parent().contains("1.7");
  });

  it("Test IPP", function () {
    cy.get('[placeholder="SMILES"]').type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="home-ipp"]').invoke("removeAttr", "target").click();
    cy.url().should("include", "IPP&target=C1CCC(OC2CCCCC2)CC1");
  });

  it("Test Tree Builder", function () {
    cy.get('[placeholder="SMILES"]').type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="home-build-tree"]').click();
    cy.waitCelery();
    cy.get('[data-cy="home-view-tree-results"]').contains("Visit Results");
  });

  it("Test Predict Forward Synthesis", function () {
    cy.get('[placeholder="SMILES"]').type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="home-forward-synthesis"]')
      .invoke("removeAttr", "target")
      .click();
    cy.url().should("include", "forward&reactants=C1CCC(OC2CCCCC2)CC1");
  });

  it("Test Predict Forward Synthesis", function () {
    cy.get('[placeholder="SMILES"]').type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="home-predict-impurties"]')
      .invoke("removeAttr", "target")
      .click();
    cy.url().should("include", "impurity&reactants=C1CCC(OC2CCCCC2)CC1");
  });

  it("Test Predict Aromatic Site Selectivity", function () {
    cy.get('[placeholder="SMILES"]').type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="home-site-selectivity"]')
      .invoke("removeAttr", "target")
      .click();
    cy.url().should("include", "sites&reactants=C1CCC(OC2CCCCC2)CC1");
  });

  it("Test Solvent Screen", function () {
    cy.get('[placeholder="SMILES"]').type("C1CCC(OC2CCCCC2)CC1");
    cy.get('[data-cy="home-solvent-screen"]')
      .invoke("removeAttr", "target")
      .click();
    cy.url().should("include", "solscreen&solute=C1CCC(OC2CCCCC2)CC1");
  });

  it("Test Buyables", function () {
    cy.get('[placeholder="SMILES"]').type("C1CCCCCCC1");
    cy.get('[data-cy="home-buyables"]').invoke("removeAttr", "target").click();
    cy.url().should("include", "buyables?q=C1CCCCCCC1");
    cy.get('[data-cy="buyables-table"]').contains("SMILES");
  });

  it("Test QM Prediction", function () {
    cy.get('[placeholder="SMILES"]').type("C1CCCCCCC1");
    cy.get('[data-cy="home-qm-descriptors"]')
      .invoke("removeAttr", "target")
      .click();
    cy.url().should("include", "qm?smiles=C1CCCCCCC1");
    cy.get('[data-cy="qm-table"]').contains("npa charge (e)");
  });
});
