// type definitions for Cypress object "cy"
/// <reference types="cypress" />
import '@testing-library/cypress/add-commands' //Add Cypress testing library
import 'cypress-iframe';  //Add support library to interact with iframes

/**
 * Authentication Commands
 */

/**
 * Custom command to handle user login
 * @param {string} username - The username to login with
 * @param {string} password - The password to login with
 */

Cypress.Commands.add('getUserCredentials', (userName) => {
  return cy.env([userName]).then((env) => {
    const user = env[userName];
    if (!user) {
      throw new Error(`User '${userName}' not found in Cypress environment`);
    }
    return {
      username: user.username,
      password: user.password
    };
  });
});

Cypress.Commands.add("login", (username, password) => {
  cy.session(
    username,
    () => {
      cy.visit("/login");
      cy.get("[data-cy=username]").type(username);
      cy.get("[data-cy=password]").type(password, { log: false });
      cy.get("[data-cy=login]").click();
      cy.url().should("include", "/");
      cy.get("[data-cy=home-username]").should("be.visible").and("contain", username);
    },
    {
      validate: () => {
        cy.getCookie("access_token").should("exist");
      },
    }
  );
});

/**
 * API Wait Commands
 */

/**
 * Custom command to wait for Celery task completion
 */
Cypress.Commands.add("waitCelery", () => {
  cy.intercept("GET", "/api/legacy/celery/task/*").as("celery-task");
  const POLLING_INTERVAL = 1000;

  const checkTaskStatus = () => {
    cy.wait("@celery-task").then((interception) => {
      const { complete, failed } = interception.response.body;
      if (complete || failed) {
        return;
      }
      cy.wait(POLLING_INTERVAL);
      checkTaskStatus();
    });
  };

  checkTaskStatus();
});

/**
 * Custom command to wait for results
 */
Cypress.Commands.add("waitResult", () => {
  cy.intercept("GET", "/api/results/list").as("result");
  const POLLING_INTERVAL = 3000;

  const checkResults = () => {
    cy.wait("@result").then((interception) => {
      if (interception.response) {
        return;
      }
      cy.wait(POLLING_INTERVAL);
      checkResults();
    });
  };

  checkResults();
});

/**
 * Custom command to set up tree result intercepts before navigation
 */
Cypress.Commands.add("setupTreeResultIntercepts", () => {
  cy.intercept("GET", "/api/results/*").as("result");
  cy.intercept("POST", "/api/scscore/batch/call-sync").as("scscore");
  cy.intercept("GET", "/api/template/lookup").as("template");
});

/**
 * Custom command to wait for tree reload results
 * Note: setupTreeResultIntercepts should be called before the action that loads the tree
 */
Cypress.Commands.add("waitReloadTreeResult", () => {
  const TIMEOUT = 30000;
  
  // Wait for the required endpoints
  cy.wait('@result', { timeout: TIMEOUT });
  cy.wait('@scscore', { timeout: TIMEOUT });
  
  // Wait a bit for the page to settle
  cy.wait(1000);
});

/**
 * Custom command to wait for API responses
 */
Cypress.Commands.add("waitAPI", () => {
  const API_PATTERNS = {
    "get-api": "/api/*/*",
    "get-api2": "/api/*/*/*",
    "get-api3": "/api/*/*/*/*",
    "post-api": "/api/*/*",
    "post-api2": "/api/*/*/*",
  };

  // Intercept all API patterns
  Object.entries(API_PATTERNS).forEach(([alias, pattern]) => {
    const method = alias.startsWith("post") ? "POST" : "GET";
    cy.intercept(method, pattern).as(alias);
  });

  const requests = Object.keys(API_PATTERNS).map((key) => `@${key}`);
  const TIMEOUT = 30000;

  cy.wait(requests, { timeout: TIMEOUT }).then((interceptions) => {
    interceptions.forEach((interception) => {
      if (!interception.response) {
        throw new Error(
          `Request ${interception.alias} did not receive a response`
        );
      }
    });
  });
});

/**
 * Visualization Network Commands
 */

/**
 * Helper function to access visNetwork and resultsStore
 * @param {Function} callback - Callback function to execute with network and store
 */
function visRun(callback) {
  cy.window().should("have.property", "visNetwork");
  cy.window().then(async (win) => {
    const { visNetwork: network, resultsStore: store } = win;
    if (network && store) {
      await callback({ network, store });
    } else {
      throw new Error(
        "Required page globals (visNetwork or resultsStore) not found"
      );
    }
  });
}

Cypress.Commands.add("visRun", visRun);

/**
 * Get count of reaction nodes
 * @returns {number} Count of reaction nodes
 */
Cypress.Commands.add("getReactionNodeCount", () => {
  return visRun(({ store }) => {
    const nodes = store.dispGraph.nodes.get({
      filter: (node) => node.type === "reaction",
    });
    return cy.wrap(nodes.length);
  });
});

/**
 * Get reaction node by SMILES
 * @param {string} smiles - SMILES string to search for
 * @returns {string} Node ID or 'none' if not found
 */
Cypress.Commands.add("getReactionNode", (smiles) => {
  return visRun(({ store }) => {
    const nodes = store.dispGraph.nodes.get({
      filter: (node) => node.type === "reaction" && node.smiles === smiles,
    });
    return cy.wrap(nodes.length > 0 ? nodes[0].id : "none");
  });
});

/**
 * Get chemical node by SMILES
 * @param {string} smiles - SMILES string to search for
 * @returns {string} Node ID or 'none' if not found
 */
Cypress.Commands.add("getChemicalNode", (smiles) => {
  return visRun(({ store }) => {
    const nodes = store.dispGraph.nodes.get({
      filter: (node) => node.type === "chemical" && node.smiles === smiles,
    });
    return cy.wrap(nodes.length > 0 ? nodes[0].id : "none");
  });
});

/**
 * Get tree reaction node by SMILES
 * @param {string} smiles - SMILES string to search for
 * @returns {string} Node ID or 'none' if not found
 */
Cypress.Commands.add("getTreeReactionNode", (smiles) => {
  return visRun(({ store, network }) => {
    const nodes = store.treeDispGraph.nodes.get({
      filter: (node) => node.type === "reaction" && node.smiles === smiles,
    });

    if (nodes.length === 0) {
      return cy.wrap("none");
    }

    const nodeID = nodes[0].id;
    const positions = network.getPositions([nodeID]);
    return cy.wrap(Object.keys(positions).length === 0 ? "none" : nodeID);
  });
});

/**
 * Get tree chemical node by SMILES
 * @param {string} smiles - SMILES string to search for
 * @returns {string} Node ID or 'none' if not found
 */
Cypress.Commands.add("getTreeChemicalNode", (smiles) => {
  return visRun(({ store }) => {
    const nodes = store.treeDispGraph.nodes.get({
      filter: (node) => node.type === "chemical" && node.smiles === smiles,
    });
    return cy.wrap(nodes.length > 0 ? nodes[0].id : "none");
  });
});

/**
 * Open node detail by clicking on the node
 * @param {string} nodeID - ID of the node to open
 */
Cypress.Commands.add("openNodeDetail", (nodeID) => {
  visRun(({ network }) => {
    const position = network.getPositions([nodeID])[nodeID];
    const { x, y } = network.canvasToDOM(position);
    cy.get("canvas").click(x, y);
  });
});

/**
 * Get cluster for a node
 * @param {string} nodeID - ID of the node to get cluster for
 * @returns {string} Cluster name or 'Undefined Cluster'
 */
Cypress.Commands.add("getCluster", (nodeID) => {
  return visRun(({ network }) => {
    const nodes = network.clustering.findNode(nodeID);
    return cy.wrap(nodes?.length ? nodes[0] : "Undefined Cluster");
  });
});

/**
 * Get selected nodes
 * @returns {string[]} Array of selected node IDs
 */
Cypress.Commands.add("getSelectedNodes", () => {
  return visRun(({ network }) => {
    return cy.wrap(network.getSelectedNodes());
  });
});

Cypress.Commands.add('getIframeBody', (iframeSelector) => {
  return cy.get(iframeSelector)
    .its('0.contentDocument.body').should('not.be.empty')
    .then(cy.wrap);
});

