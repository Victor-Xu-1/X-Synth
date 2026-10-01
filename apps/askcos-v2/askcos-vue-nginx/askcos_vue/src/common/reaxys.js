/*
 * Reaxys utilities
 */

const BASE_URL = "https://www.reaxys.com/reaxys/secured/hopinto.do?context=R";
const ORIGIN = "&origin=askcos&ln=";

function createReaxysUrl(rxnIds) {
  const query = `&query=${rxnIds.map((rid) => `RX.ID=${rid}`).join(" OR ")}`;
  return encodeURI(`${BASE_URL}${query}${ORIGIN}`);
}

function createReaxysQuery(rxnIds) {
  return JSON.stringify({
    fileName: "reaxys_query.json",
    version: "1.0",
    content: {
      id: "root",
      facts: [
        {
          id: "Reaxys487",
          fields: [
            {
              value: rxnIds.join("; "),
              boundOperator: "op_num_equal",
              id: "RX.ID",
              displayName: "Reaction ID",
            },
          ],
          fieldsLogicOperator: "AND",
          exist: false,
          bio: false,
        },
      ],
    },
    exist: false,
    bio: false,
  });
}

export { createReaxysQuery, createReaxysUrl };
