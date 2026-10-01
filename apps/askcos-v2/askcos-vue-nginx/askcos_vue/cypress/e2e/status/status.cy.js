// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("synon Status Page", () => {
  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.visit("/status");
  });

  it("Should load and display data table after fetching", () => {
    cy.get(".v-data-table").should("be.visible");
    cy.get(".v-data-table")
      .find("tbody")
      .find("tr")
      .its("length")
      .should("be.gt", 0);
  });

  it("Clicking refresh should trigger data refresh", () => {
    cy.intercept("GET", "/api/status/celery/get").as("getStatus");
    cy.get('[data-cy="refresh-button"]').click();
    cy.wait("@getStatus");
    cy.get("span.text-body-2").should("contain", "Last Update:");
  });
});
