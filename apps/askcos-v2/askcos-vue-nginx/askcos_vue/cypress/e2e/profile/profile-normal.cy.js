// type definitions for Cypress object "cy"
/// <reference types="cypress" />

describe("Normal User Profile tests", () => {
  // Create username and password global variables
  let username;
  let password;

  before(() => {
    // Set username and password
    /*cy.env(['validUser']).then(({ validUser }) => {
      username = validUser.username;
      password = validUser.password;
      //cy.log(`Logging in as ${username}`);
      //cy.log(`Logging in with ${password}`);
    });*/
    cy.getUserCredentials('validUser').then((credentials) => {
      username = credentials.username;
      password = credentials.password;
    });
  });

  beforeEach(() => {
    cy.viewport("macbook-11");
    cy.log(`Logging in as ${username}`);
    cy.log(`Logging in with ${password}`);
    // Login with username and password
    cy.login(username, password);

    cy.visit("/admin");
  });
  
  afterEach(() => {
    // Logout
    cy.contains("Logout").click();
    cy.url().should('include', 'admin-login')
  });

  it("Check not a super user", () => {
    //Check if page contains synon 用户, this only shown on
    // superuser page
    cy.get('body').then($body => {
      // If there in no data in the table, we're done
      if (!$body.text().includes('synon 用户')) {
      return;
      };
    });
    // Double check to-be-sure-to-be-sure
    cy.get('body').should('not.contain', 'synon 用户');
  });

  it("Change user email", () => {
    // Check email address, it should be cypress@mit.edu
    cy.get('[data-cy="admin-change-email-normal-user"]').should('be.visible');
    cy.get('[data-cy="admin-get-email-address-normal-user"]').should('contain', 'cypress@mit.edu');
    // Change the email address
    cy.get('[data-cy="admin-change-email-normal-user"]').click();
    cy.get('[data-cy="admin-edit-user-value"]').clear();
    cy.get('[data-cy="admin-edit-user-value"]').type("cypress_test@mit.edu");
    cy.get('[data-cy="openDialog-submit"]').click();

    // Check for the new email address, it should be cypress_test@mit.edu
    cy.get('[data-cy="admin-change-email-normal-user"]').should('be.visible');
    cy.get('[data-cy="admin-get-email-address-normal-user"]').should('contain', 'cypress_test@mit.edu');
    
    // Change the email address back to the original
    cy.get('[data-cy="admin-change-email-normal-user"]').click();
    cy.get('[data-cy="admin-edit-user-value"]').clear();
    cy.get('[data-cy="admin-edit-user-value"]').type("cypress@mit.edu");
    cy.get('[data-cy="openDialog-submit"]').click();

    // Check email address, it should be cypress@mit.edu
    cy.get('[data-cy="admin-change-email-normal-user"]').should('be.visible');
    cy.get('[data-cy="admin-get-email-address-normal-user"]').should('contain', 'cypress@mit.edu');
  });

  it("Change user password", () => {
    // Check email address, it should be cypress@mit.edu
    cy.get('[data-cy="admin-change-email-normal-user"]').should('be.visible');
    cy.get('[data-cy="admin-get-email-address-normal-user"]').should('contain', 'cypress@mit.edu');
    // Change the password
    cy.get('[data-cy="admin-change-password-normal-user"]').click();
    cy.get('[data-cy="admin-edit-user-value"]').clear();
    cy.get('[data-cy="admin-edit-user-value"]').type("reallybadpassword2");
    cy.get('[data-cy="openDialog-submit"]').click();

    // Logout
    cy.contains("Logout").click();
    cy.url().should('include', 'admin-login')

    // Log back in with the new password & verify
    cy.login(username, "reallybadpassword2");
    cy.visit("/admin");

    // Change password back to the old password (reallybadpassword)
    // otherwise all future tests will fail!!!

    // Check for the new email address, it should be cypress_test@mit.edu
    cy.get('[data-cy="admin-change-email-normal-user"]').should('be.visible');
    cy.get('[data-cy="admin-get-email-address-normal-user"]').should('contain', 'cypress@mit.edu');
    
    // Change the password back to original
    cy.get('[data-cy="admin-change-password-normal-user"]').click();
    cy.get('[data-cy="admin-edit-user-value"]').clear();
    cy.get('[data-cy="admin-edit-user-value"]').type("reallybadpassword");
    cy.get('[data-cy="openDialog-submit"]').click();

    // Logout
    cy.contains("Logout").click();
    cy.url().should('include', 'admin-login')

    // Log back in with the new password & verify
    cy.login(username, password);
    cy.visit("/admin");
    cy.contains("Hello, cypress!");
  });
});
