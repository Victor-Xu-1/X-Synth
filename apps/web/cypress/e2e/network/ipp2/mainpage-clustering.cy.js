
 
/* eslint-disable no-unused-vars */
// type definitions for Cypress object "cy"
/// <reference types="cypress" />



describe("IPP Page", () => {
  // Create username and password global variables
  let username;
  let password;

  before(() => {
    // Set username and password
    cy.getUserCredentials("validUser").then((credentials) => {
      username = credentials.username;
      password = credentials.password;
    });
  });  
  /* ==== Test Created with Cypress Studio ==== */
    beforeEach(() => {
      // Listen for uncaught exceptions and handle the ResizeObserver error
      cy.on('uncaught:exception', (err, runnable) => {
        // Check if the error is a ResizeObserver loop error
        if (err.message.includes('ResizeObserver loop completed with undelivered notifications')) {
          // Prevent Cypress from failing the test when this error occurs
          return false; // returning false prevents the test from failing
        }
        // Otherwise, let Cypress handle the error as usual
        return true;
      });
      
      cy.viewport("macbook-11");
      //const username = Cypress.env('validUser').username
      //const password = Cypress.env('validUser').password
      cy.login(username, password);
      cy.visit("/banlist")
      cy.get('[data-cy="banlist-reset"]').click()
      cy.get('[data-cy="banlist-reset"]').click()
      cy.visit("/network?tab=IPP");
  
      cy.get(".v-input")
        .get('[placeholder="SMILES"]')
        .type("C1CCC(OC2CCCCC2)CC1");
    });


    it("Clustering - hdbscan", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('#card-1').within(() => {
                cy.contains('Reaction Cluster #1')
              })
              cy.get('#card-2').within(() => {
                cy.contains('Reaction Cluster #2')
              })
              cy.get('[id^=card-]')
                .its('length')
                .then((len) => {
                    expect(len).to.equal(6);
                })

            }
          );
    });

    it("Clustering - hdbscan - toggle off", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('[data-cy="node-detail-cluster-toggle"]').click()
              cy.get('[id^=card-]')
                .its('length')
                .then((len) => {
                    expect(len).to.equal(100);
                })

            }
          );
    });

    it("Clustering - kmeans", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-method"]').find('.v-input').click()
        cy.get('.v-list-item-title').contains('kmeans').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('#card-1').within(() => {
                cy.contains('Reaction Cluster #1')
              })
              cy.get('[id^=card-]').eq(1).within(() => {
                cy.contains('Reaction Cluster #2')
              })
              cy.get('[id^=card-]')
                .its('length')
                .then((len) => {
                    expect(len).gt(2);
                })
            }
          );
    });

    it("Clustering - rxnclass", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-method"]').find('.v-input').click()
        cy.get('.v-list-item-title').contains('rxn_class').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('#card-2').within(() => {
                cy.contains('substitution')
              })
              cy.get('[id^=card-]')
                .its('length')
                .then((len) => {
                    expect(len).gt(2);
                })
            }
          );
    });

   it("Clustering - hdbscan - toggle off", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('[data-cy="node-detail-cluster-toggle"]').click()
              cy.get('[id^=card-]')
                .its('length')
                .then((len) => {
                    expect(len).to.equal(100);
                })

            }
          );
    });

    it("Clustering - precursor section - hide node from canvas", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getReactionNode("O=C1CCCCC1.O=C1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
                expect(nodeID).not.eq('none')
        })
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('#card-1').find("#hide-from-canvas").click()

            }
          );
        cy.getReactionNode("O=C1CCCCC1.O=C1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
                expect(nodeID).eq('none')
        })
    });

    it("Clustering - precursor section - delete node from canvas", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getReactionNode("O=C1CCCCC1.O=C1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
                expect(nodeID).not.eq('none')
        })
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('#card-1').find("#delete-from-canvas").click()
              cy.get('.v-card-actions').contains("Ok").click()
            }
          );
        cy.getReactionNode("O=C1CCCCC1.O=C1CCCCC1>>C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
                expect(nodeID).eq('none')
        })
    });

    it("Clustering - precursor section - clustering modal", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('#card-1').find("#open-cluster-modal").click()
              cy.get('#cpShowScore').click()
              cy.get('#cluster-card-1').should('contain', 'Precursor score');
              cy.get('#cpShowSCScore').click()
              cy.get('#cluster-card-1').should('contain', 'Synthetic complexity');
              //cy.get('#cpShowTemp').click()
              //cy.get('#cluster-card-1').should('contain', 'Template score');

              cy.get('[data-cy="node-details-clustering-right"]').click().click().click();
              cy.get('[data-cy="node-details-clustering-left"]').click().click().click();
              cy.get('#node-detail-cluster-close').click();
            }
          );

    });

    it("Clustering - precursor section - clustering modal - add precursors", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('#card-1').find("#open-cluster-modal").click()
              cy.get('#node-details-clustering-add-precursor').click()
              cy.get('#node-details-clustering-add-precursor-smiles').type("CCCC");
              cy.get('#node-details-clustering-add-precursor-confirm').click();
              cy.get('#cluster-card-101').should('contain', 'Rank');
              cy.get('#node-detail-cluster-close').click();
              cy.get('canvas').should('be.visible');

            }
          );

    });

    // TODO: Need to write drag and drop 
    it("Clustering - precursor section - clustering modal - edit precursors", function () {
        cy.get('[data-cy="ipp-strategy-settings"]').click()
        cy.get('[data-cy="ipp-settings-clustering"]').click()
        cy.get('[data-cy="ipp-strategy-clustering-toggle"]').click()
        cy.get('[data-cy="ipp-setting-save"]').click()
        cy.get('[data-cy="ipp-one-step"]').click();
        cy.waitAPI();
        cy.getChemicalNode("C1CCC(OC2CCCCC2)CC1").then(
            (nodeID) => {
              cy.openNodeDetail(nodeID)
              cy.get('#card-1').find("#open-cluster-modal").click()
              cy.get('#node-details-clustering-edit-cluster').click()
            //   cy.get(':nth-child(3) > .grid-wrapper-onerow > :nth-child(4)').click()
            //   cy.dragAndDrop('#edit-cluster-card-7', '.grid-wrapper-onerow > :nth-child(2)');
            //   cy.get('#node-details-clustering-edit-cluster-close').click()
            //   cy.get('canvas').should('be.visible');
            }
          );

    });

});