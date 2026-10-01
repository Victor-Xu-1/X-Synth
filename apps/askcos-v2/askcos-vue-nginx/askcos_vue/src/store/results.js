import { defineStore } from "pinia";
import { RetroGraph, isChemical, isReaction } from "@/common/graph";
import { lookupBuyables } from "@/common/buyables";
import { v4 as uuidv4, NIL as NIL_UUID } from "uuid";
import { API } from "@/common/api";
import { createReactionEvidenceInput } from "@/common/reaction-evidence";
// import { tbSettingsPyToJs } from "@/common/tb-settings";
// import { checkTemplatePrioritizers } from "@/views/network/utils";
import {
  makeChemicalDisplayNode,
  makeReactionDisplayNode,
  makeDisplayEdge,
} from "@/views/network/visualization";
import dayjs from "dayjs";
import { useSettingsStore } from "./settings";

function precursorSmilesFromRxn(s) {
  return typeof s === "string" ? s.split(">>")[0] : "";
}

function normalizePricingProperties(properties) {
  if (!properties) {
    return [];
  }
  return Array.isArray(properties) ? properties : [properties];
}

function getPricingProperty(properties, keys) {
  const normalized = normalizePricingProperties(properties);
  for (const entry of normalized) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    for (const key of keys) {
      if (entry[key] !== undefined && entry[key] !== null && entry[key] !== "") {
        return entry[key];
      }
    }
  }
  return null;
}

export const useResultsStore = defineStore("results", {
  state: () => {
    const persisted = JSON.parse(localStorage.getItem('filterNearCycles'));
    return {
      dataGraph: new RetroGraph(),
      dispGraph: new RetroGraph(),
      recommendedTemplates: {},
      target: "",
      templateNumExamples: {}, // Map from template ID to training reaction count
      templateSetSource: {}, // Map from template ID to template set which it came from
      trees: [],
      treeNodeMap: {}, // Tracks nodes in trees, similar to inVis attribute, {smiles: {parentid: nodeid}}
      treeEdgeMap: {}, // Tracks edges in trees, similar to dispGraph._succ, {parentid: {nodeid: edgeid}}
      recomputeData: 0, // Dummy variable for triggering computed properties which depend on dataGraph
      recomputeDisp: 0, // Dummy variable for triggering computed properties which depend on dispGraph
      savedResultInfo: {
        id: "",
        description: "",
        tags: [],
        type: "ipp",
        created: "",
        modified: "",
        createdDisp: "",
        modifiedDisp: "",
        tbSettings: null,
        tbStats: null,
        overwrite: true,
        target: "",
        tbVersion: "2",
      },
      removedReactions: {},
      filterNearCycles: persisted || false,
    };
  },
  getters: {
    clusteredResults: (state) => {
      // Mapping of target smiles to list of cluster representatives
      // {'targetSmiles0':[{cluster0_rep}, {cluster1_rep},...], ...}
      let recomputeData = state.recomputeData;
      console.debug(recomputeData);
      let res = {};
      let options = {
        filter: (item) => item.clusterRep,
        order: (a, b) => a.clusterId - b.clusterId,
      };
      for (let target of state.dataGraph.nodes.getIds({ filter: isChemical })) {
        res[target] = state.dataGraph.nodes.get(
          state.dataGraph.getSuccessors(target),
          options
        );
      }
      return res;
    },
    clusteredResultsIndex: (state) => {
      // Mapping of target smiles to list of cluster IDs in ascending order
      // {'targetSmiles0':[unique cluster Ids in ascending order], ...}
      let recomputeData = state.recomputeData;
      console.debug(recomputeData);
      let res = {};
      for (let target of state.dataGraph.nodes.getIds({ filter: isChemical })) {
        let precursors = state.dataGraph.nodes.get(
          state.dataGraph.getSuccessors(target)
        );
        res[target] = [...new Set(precursors.map((rxn) => rxn.clusterId))].sort(
          (a, b) => a - b
        );
      }
      return res;
    },
  },
  actions: {
    apiTemplateCount(templateIds) {
      const lookup = templateIds.filter(
        (id) => this.templateNumExamples[id] === undefined
      );
      if (lookup.length > 0) {
        API.post("/api/template/lookup/", {
          ids: lookup,
          field: "count",
        }).then((json) => {
          Object.assign(this.templateNumExamples, json.result);
        });
      }
    },
    apiTemplateSet(templateIds) {
      const lookup = templateIds.filter(
        (id) => this.templateSetSource[id] === undefined
      );
      if (lookup.length > 0) {
        API.post("/api/template/lookup/", {
          ids: lookup,
          field: "template_set",
        }).then((json) => {
          Object.assign(this.templateSetSource, json.result);
        });
      }
    },
    updateImageUrls(smiles) {
      const settings = useSettingsStore();
      smiles = smiles || this.dataGraph.getChemicalNodeIds();
      this.updateDispNodes(
        smiles.flatMap((smi) => {
          let dataObj = this.dataGraph.nodes.get(smi);
          let nodeIds = this.dispGraph.nodes.getIds({
            filter: (item) => item.smiles === smi,
          });
          return nodeIds.map((nodeId) =>
            makeChemicalDisplayNode({
              id: nodeId,
              data: dataObj,
              target: this.target,
              align: settings.alignNodeImagesToTarget,
            })
          );
        })
      );
    },
    async updateChemicalMetadata(smiles) {
      const settings = useSettingsStore();
      const sources = settings.tbSettings.buyablesSourceAll
        ? null
        : settings.tree_builder_settings.build_tree_options.buyables_source;
      const templateSets =
        settings.interactive_path_planner_settings.retro_backend_options.map(
          (tp) => tp["retro_model_name"]
        );

      // Skip buyables lookup for SMILES that already have pricing from expand_one
      const smilesNeedingPrice = smiles.filter(
        (smi) => this.dataGraph.nodes.get(smi)?.ppg === undefined
      );

      const [history, price, scscore] = await Promise.all([
        getHistory(smiles, templateSets),
        smilesNeedingPrice.length > 0
          ? getPrice(smilesNeedingPrice, sources)
          : Promise.resolve({}),
        getScscore(smiles),
      ]);

      this.updateDataNodes(
        smiles.map((smi) => ({
          id: smi,
          ...history[smi],
          ...(price[smi] || {}),
          ...scscore[smi],
        }))
      );
      this.updateImageUrls(smiles);
    },
    async updatePrice(smiles) {
      const settings = useSettingsStore();
      let sources = settings.tbSettings.buyablesSourceAll
        ? null
        : settings.tree_builder_settings.build_tree_options.buyables_source;
      const price = await getPrice(smiles, sources);
      this.updateDataNodes(
        smiles.map((smi) => {
          return Object.assign({ id: smi }, price[smi]);
        })
      );
      this.updateImageUrls(smiles);
    },
    async updateScscore(smiles) {
      const scscore = await getScscore(smiles);
      this.updateDataNodes(
        smiles.map((smi) => {
          return Object.assign({ id: smi }, scscore[smi]);
        })
      );
    },
    async loadResult({ resultId, numTrees }) {
      let url = "/api/results/retrieve";
      const json = await API.get(url, { result_id: resultId });
      if (json.error) {
        throw new Error(json.error);
      }
      if (json["result_type"] === "ipp") {
        return this.importIppResult({ data: json });
      } else if (json["result_type"] === "tree_builder") {
        return this.importTreeBuilderResult({
          data: json,
          numTrees: numTrees,
        });
      } else if (json["result_type"] === "graph_optimization") {
        return this.importGraphOptimizationResult({ data: json });
      }
    },
    canonicalizeSmiles(smiles) {
      if (!smiles) {
        return Promise.resolve(smiles);
      }
      return API.post("/api/rdkit/canonicalize", {
        smiles,
      })
        .then((json) => json?.smiles || smiles)
        .catch(() => smiles);
    },
    importIppResult({ data }) {
      const settings = useSettingsStore();
      let resultObj = data;
      // Update saved result info
      let savedResultInfo = {
        id: resultObj["result_id"],
        description: resultObj["description"],
        tags: resultObj["tags"],
        type: data["result_type"],
        created: resultObj["created"],
        modified: resultObj["modified"],
        createdDisp: dayjs(resultObj["created"]).format("MMMM D, YYYY h:mm A"),
        modifiedDisp: dayjs(resultObj["modified"]).format(
          "MMMM D, YYYY h:mm A"
        ),
        target: resultObj["target_smiles"],
      };
      this.updateSavedResultInfo(savedResultInfo);
      // Restore result graphs
      this.importDataJSON(resultObj["result"]["dataGraph"]);
      this.importDispJSON(resultObj["result"]["dispGraph"]);
      // Restore settings
      settings.setVisjsOptions(resultObj["settings"]["network"], {
        root: true,
      });
      settings.setTbSettings(resultObj["settings"]["tb"], {
        root: true,
      });
      settings.setIppSettings(resultObj["settings"]["ipp"], {
        root: true,
      });
      this.setTarget(this.dispGraph.nodes.get(NIL_UUID)["smiles"]);
      // Retrieve template example count and template set metadata
      let templates = [];
      this.dataGraph.nodes.get({ filter: isReaction }).forEach((n) => {
        if (n["templateIds"]) {
          templates.push(...n["templateIds"]);
        }
      });
      let promises = [];
      promises.push(this.apiTemplateCount(templates));
      promises.push(this.apiTemplateSet(templates));
      return Promise.all(promises);
    },
    async importTreeBuilderResult({ data, numTrees }) {
      const settings = useSettingsStore();
      let resultObj = data;
      let target = resultObj["target_smiles"].trim();
      const unifiedRoutePool = getUnifiedRoutePool(resultObj);
      const canonicalTargetFromUds =
        resultObj["result"]?.["uds"]?.["uuid2smiles"]?.[NIL_UUID];
      const canonicalTarget =
        canonicalTargetFromUds || (await this.canonicalizeSmiles(target));
      this.setTarget(canonicalTarget);
      // Disable precusrsor clustering by default for tree builder results
      settings.setOption({ key: "allowCluster", value: false }, { root: true });
      // Use hierarchical layout by default for tree builder results
      settings.setVisHierachicalEnabled(true, { root: true });
      // Update saved result info
      let savedResultInfo = {
        id: resultObj["result_id"],
        description: resultObj["description"],
        type: data["result_type"],
        created: resultObj["created"],
        modified: resultObj["modified"],
        createdDisp: dayjs(resultObj["created"]).format("MMMM D, YYYY h:mm A"),
        modifiedDisp: dayjs(resultObj["modified"]).format(
          "MMMM D, YYYY h:mm A"
        ),
        tbSettings: resultObj["settings"],
        target: canonicalTarget,
        tbVersion: resultObj["result"]?.["version"],
      };
      let status = null;
      // let status = resultObj["result"]["stats"];
      let stats = resultObj["result"]?.["stats"];
      if (status) {
        savedResultInfo["tbStats"] = {
          total_chemicals: status[0],
          total_reactions: status[1],
        };
      } else if (stats) {
        savedResultInfo["tbStats"] = stats;
      }
      this.updateSavedResultInfo(savedResultInfo);
      // Import settings
      // let tbSettings = tbSettingsPyToJs(resultObj["settings"]);
      // settings.setTbSettings(tbSettings, { root: true });
      // Import result graphs
      let transformedResult = unifiedRoutePool?.selected_routes?.length
        ? convertUnifiedRoutePool(unifiedRoutePool, canonicalTarget)
        : convertUDS(resultObj["result"]["uds"]);
      let dataGraph = transformedResult["graph"];
      let paths = transformedResult["paths"];
      let nodeMap = generateTreeNodeMap(paths);
      let edgeMap = assignEdgeIds(paths);
      this.setTreeNodeMap(nodeMap);
      this.setTreeEdgeMap(edgeMap);
      let promises = [];
      if (dataGraph) {
        promises.push(this.addTreeBuilderResultToDataGraph(dataGraph));
      }
      this.addDispNodes(
        makeChemicalDisplayNode({
          id: NIL_UUID,
          data: { id: canonicalTarget },
          target: canonicalTarget,
        })
      );
      if (numTrees) {
        paths.slice(0, numTrees).forEach((path) => {
          this.addTreeToDispGraph(path);
        });
      }
      if (paths) {
        this.setTrees(paths);
      }
      return Promise.all(promises);
    },
    importGraphOptimizationResult({ data }) {
      const settings = useSettingsStore();
      let resultObj = data["result"];
      let target = resultObj["settings"]["targets"][0];
      this.setTarget(target);
      // Disable precusrsor clustering by default for tree builder results
      settings.setOption({ key: "allowCluster", value: false }, { root: true });
      // Use hierarchical layout by default for tree builder results
      settings.setVisHierachicalEnabled(true, { root: true });
      // Update saved result info
      let savedResultInfo = {
        id: resultObj["_id"],
        description: resultObj["description"],
        type: data["result_type"],
        created: resultObj["created"],
        modified: resultObj["modified"],
        createdDisp: dayjs(resultObj["created"]).format("MMMM D, YYYY h:mm A"),
        modifiedDisp: dayjs(resultObj["modified"]).format(
          "MMMM D, YYYY h:mm A"
        ),
        tbSettings: resultObj["settings"],
      };
      this.updateSavedResultInfo(savedResultInfo);
      // Import result
      let dataGraph = resultObj["result"]["dataGraph"];
      let paths = resultObj["result"]["paths"];
      assignEdgeIds(paths);
      let promises = [];
      if (dataGraph) {
        promises.push(this.addTreeBuilderResultToDataGraph(dataGraph));
      }
      this.addDispNodes(
        makeChemicalDisplayNode({
          id: NIL_UUID,
          data: { id: target },
          target: target,
        })
      );
      if (paths) {
        paths.forEach((path) => {
          this.addTreeToDispGraph(path);
        });
        this.setTrees(paths);
      }
      return Promise.all(promises);
    },
    updateExistingReactionNode(existingNode, reaction) {
      const evidenceInput = createReactionEvidenceInput(reaction);

      existingNode.retroScore = Math.max(
        existingNode.retroScore,
        reaction.precursor_score
      );

      existingNode.ffScore = Math.max(
        existingNode.ffScore,
        reaction.reaction_properties?.plausibility
      );

      existingNode.averageModelScore =
        (existingNode.averageModelScore + reaction.average_model_score) / 2.0;

      if (
        reaction.template &&
        existingNode.templateScore <= reaction.template.template_score
      ) {
        existingNode.templateRank = reaction.template.template_rank;
        existingNode.templateScore = reaction.template.template_score;
      }

      // Deduplicate modelMetadata based on model name, training set
      if (reaction.model_metadata && reaction.model_metadata.length > 0) {
        // Create a map to track unique models by their key attributes
        const uniqueModels = new Map();

        // First, add existing models to the map
        if (
          existingNode.modelMetadata &&
          existingNode.modelMetadata.length > 0
        ) {
          existingNode.modelMetadata.forEach((model) => {
            // Create a more comprehensive key that includes model attributes
            const key = `${model.backend}-${model.model_name}`;
            uniqueModels.set(key, model);
          });
        }

        // Then add new models, replacing existing ones if they have the same key
        reaction.model_metadata.forEach((model) => {
          // Create a more comprehensive key that includes model attributes
          const key = `${model.backend}-${model.model_name}`;
          uniqueModels.set(key, model);
        });

        // Convert the map values back to an array
        existingNode.modelMetadata = Array.from(uniqueModels.values());
      } else if (existingNode.modelMetadata) {
        // If there's no new model metadata but existing node has it, keep the existing
        // No need to change anything
      } else {
        // If neither has model metadata, initialize as empty array
        existingNode.modelMetadata = [];
      }

      if (
        !existingNode.reactionData &&
        evidenceInput.reactionData &&
        Object.keys(evidenceInput.reactionData).length
      ) {
        existingNode.reactionData = evidenceInput.reactionData;
        existingNode.reactionId = evidenceInput.reactionId;
        existingNode.reactionSet = evidenceInput.reactionSet;
        existingNode.reference_reaction = evidenceInput.reactionData?.reaction_smiles;
        existingNode.reference_url = evidenceInput.reactionData?.reference_url;
        existingNode.patent_number = evidenceInput.reactionData?.patent_number;
      }

      this.updateReactionSmiles({ newNode: existingNode });
    },
    createNewReactionNode(reaction, reactionSmiles, clusterTracker) {
      // Compute total numExamples from all modelMetadata
      let totalNumExamples = 0;
      if (Array.isArray(reaction.model_metadata)) {
        totalNumExamples = reaction.model_metadata.reduce((sum, model) => {
          const n = model?.source?.template?.num_examples;
          return sum + (typeof n === "number" ? n : 0);
        }, 0);
      }
      const precursorSmiles = precursorSmilesFromRxn(reaction.outcome);
      const evidenceInput = createReactionEvidenceInput(reaction);
      const node = {
        id: reactionSmiles,
        modelMetadata: reaction.model_metadata,
        model: reaction.retro_backend, // modelMetadata
        trainingSet: reaction.retro_model_name, //modelMetadata
        models: reaction.models_predicted_by, // modelMetadata
        isCustom: !!reaction.is_custom,
        rank: reaction.precursor_rank,
        ffScore: reaction.reaction_properties?.plausibility,
        retroScore: reaction.precursor_score,
        precursorRank: reaction.precursor_rank,
        averageModelScore: reaction.average_model_score,
        templateScore: reaction.source?.template?.template_score, // modelMetadata
        templateRank: reaction.source?.template?.template_rank, // modelMetadata
        templateIds: reaction.source?.template?.tforms, // modelMetadata
        reactionData: evidenceInput.reactionData,
        reactionId: evidenceInput.reactionId,
        reactionSet: evidenceInput.reactionSet,
        reference_reaction: evidenceInput.reactionData?.reaction_smiles,
        reference_url: evidenceInput.reactionData?.reference_url,
        patent_number: evidenceInput.reactionData?.patent_number,
        clusterId: reaction.reaction_properties.cluster_id,
        clusterName: reaction.reaction_properties.cluster_name,
        clusterRep: !clusterTracker.has(
          reaction.reaction_properties.cluster_id
        ),
        precursors: reaction.smiles_split || precursorSmiles.split("."),
        precursorSmiles,
        totalNumExamples: totalNumExamples || reaction.source?.template?.num_examples, // modelMetadata
        necessaryReagent: reaction.source?.template?.necessary_reagent, // modelMetadata
        mappedSmiles: reaction.reaction_properties?.mapped_smiles?.split(">>")[0],
        reactingAtoms: reaction.reaction_properties?.reacting_atoms,
        numRings: reaction.precursor_properties?.num_rings,
        rmsMolwt: reaction.precursor_properties?.rms_molwt,
        scscore: reaction.precursor_properties?.scscore,
        precursorPrices: reaction.precursor_properties?.precursor_prices,
        type: "reaction",
        inVis: {},
      };

      if (reaction.reaction_properties.cluster_id !== undefined) {
        clusterTracker.add(reaction.reaction_properties.cluster_id);
      }

      if (reaction.outcomes !== undefined) {
        node.outcomes = precursorSmiles.split(".");
        node.selectivity = new Array(node.outcomes.length);
        node.mappedPrecursors = reaction.mapped_precursors;
        node.mappedOutcomes = reaction.mapped_outcomes;
      } else if (reaction.reaction_properties.selec_error !== null) {
        node.selecError = reaction.reaction_properties.selec_error;
      }

      return node;
    },
    addPrecursorNodes(reactionNode, newNodes, newEdges, newPrecursors) {
      for (const precursorSmiles of reactionNode.precursors) {
        if (
          !this.dataGraph.nodes.get(precursorSmiles) &&
          !newPrecursors.has(precursorSmiles)
        ) {
          const chemNode = {
            id: precursorSmiles,
            type: "chemical",
          };
          const pricing = reactionNode.precursorPrices?.[precursorSmiles];
          if (pricing) {
            chemNode.ppg = pricing.ppg || "not buyable";
            chemNode.source = pricing.source || "";
            if (pricing.smiles_match) {
              chemNode.smilesMatch = pricing.smiles_match;
            }
          }
          newNodes.push(chemNode);
          newPrecursors.add(precursorSmiles);
        }
        newEdges.push({
          id: uuidv4(),
          from: reactionNode.id,
          to: precursorSmiles,
        });
      }
    },
    async addRetroResultToDataGraph({
      data,
      parentSmiles,
      update = true,
      nodeID = null,
    }) {
      // Add results as reaction and chemical nodes under the specified parent chemical
      // Arguments should be list of outcome objects and the SMILES of the parent node
      if (!this.dataGraph.nodes.get(parentSmiles)) {
        // The parent node does not exist in the graph for some reason
        // Create it instead to avoid issues later
        console.debug(
          `Adding retro results for missing parent node ${parentSmiles}. This might result in a disconnected graph!`
        );
        this.addDataNodes({
          id: parentSmiles,
          type: "chemical",
        });
        if (update) {
          await this.updateChemicalMetadata([parentSmiles]);
        }
      }
      const existingReactions =
        this.dataGraph.getSuccessors(parentSmiles).length > 0;
      const clusterTracker = new Set(this.clusteredResultsIndex[parentSmiles]);
      const addedReactions = [];
      const templateIds = new Set();
      const newPrecursors = new Set();
      const newNodes = [];
      const newEdges = [];
      for (const reaction of data) {
        const reactionSmiles = `${reaction.outcome}>>${parentSmiles}`;
        const existingNode = this.dataGraph.nodes.get(reactionSmiles);

        if (existingNode) {
          // Update existing node, refer to UDS doc
          this.updateExistingReactionNode(existingNode, reaction);
          if (nodeID && !(nodeID in existingNode.inVis)) {
            addedReactions.push(reactionSmiles);
          }
        } else {
          // Create new reaction node
          const newNode = this.createNewReactionNode(
            reaction,
            reactionSmiles,
            clusterTracker
          );
          if (newNode.modelMetadata) {
            newNode.modelMetadata.forEach((model) => {
              if (
                model.source &&
                model.source.template &&
                model.source.template.tforms
              ) {
                model.source.template.tforms.forEach((item) =>
                  templateIds.add(item)
                );
              }
            });
          }
          newNodes.push(newNode);
          newEdges.push({
            id: uuidv4(),
            from: parentSmiles,
            to: reactionSmiles,
          });

          if (newNode.precursors) {
            this.addPrecursorNodes(newNode, newNodes, newEdges, newPrecursors);
          }

          addedReactions.push(reactionSmiles);
        }
      }

      if (newNodes.length > 0) {
        this.addDataNodes(newNodes);
      }
      if (newEdges.length > 0) {
        this.addDataEdges(newEdges);
      }

      const promises = [];
      if (existingReactions && addedReactions.length > 0) {
        promises.push(this.rerankPrecursors(parentSmiles));
      }
      if (update && newPrecursors.size > 0) {
        promises.push(this.updateChemicalMetadata([...newPrecursors]));
      }
      if (templateIds.size > 0) {
        promises.push(this.apiTemplateCount([...templateIds]));
        promises.push(this.apiTemplateSet([...templateIds]));
      }

      await Promise.all(promises);
      return addedReactions;
    },
    // Update: make this function async to support core fragment logic
    async addRetroResultToDispGraph({ data, parentId, bypassFilter = false }) {
      // Add reaction and chemical nodes with display properties under the specified parent chemical
      // Arguments should be list of reaction smiles to add and the ID of the parent node
      // bypassFilter: if true, skip near-cycle filtering (for manual additions)
      const parentNode = this.dispGraph.nodes.get(parentId);
      const settings = useSettingsStore();
      let newNodes = [];
      let newEdges = [];
      for (let reactionSmiles of data) {
        let reactionObj = this.dataGraph.nodes.get(reactionSmiles);
        if (!reactionObj) continue;

        let reactionId = uuidv4();
        let edgeId = uuidv4();
        // Check if this reaction already has an ID assigned from tree results
        if (
          this.treeNodeMap &&
          reactionSmiles in this.treeNodeMap &&
          parentId in this.treeNodeMap[reactionSmiles]
        ) {
          reactionId = this.treeNodeMap[reactionSmiles][parentId];
          edgeId = this.treeEdgeMap[parentId][reactionId];
        }
        reactionObj["inVis"][parentId] = reactionId;

        this.updateReactionSmiles({
          newNode: reactionObj,
        });
        newNodes.push(
          makeReactionDisplayNode({
            id: reactionId,
            data: reactionObj,
          })
        );
        newEdges.push(
          makeDisplayEdge({
            id: edgeId,
            from: parentId,
            to: reactionId,
            value: reactionObj["averageModelScore"],
          })
        );

        if (reactionObj.precursors) {
          for (let precursorSmiles of reactionObj.precursors) {
            let precursorObj = this.dataGraph.nodes.get(precursorSmiles);
            if (!precursorObj) {
              continue;
            }
            let precursorId = uuidv4();
            let precursorEdgeId = uuidv4();
            // Check if this precursor already has an ID assigned from tree results
            if (
              this.treeNodeMap &&
              precursorSmiles in this.treeNodeMap &&
              reactionId in this.treeNodeMap[precursorSmiles]
            ) {
              precursorId = this.treeNodeMap[precursorSmiles][reactionId];
              precursorEdgeId = this.treeEdgeMap[reactionId][precursorId];
            }
            newNodes.push(
              makeChemicalDisplayNode({
                id: precursorId,
                data: precursorObj,
                target: this.target,
                align: settings.alignNodeImagesToTarget,
              })
            );
            newEdges.push(
              makeDisplayEdge({
                id: precursorEdgeId,
                from: reactionId,
                to: precursorId,
                value: reactionObj["averageModelScore"],
              })
            );
          }
        }
      }

      let edgeParents = [];
      let predecessors = this.dispGraph.getAllPredecessors(parentId);
      for (let pn of predecessors) {
        edgeParents.push(this.dispGraph.nodes.get(pn));
      }

      // Store the reaction parent nodes which cause cycle
      let removeReactionNodes = [];
      for (let p of edgeParents) {
        if (p.type === "reaction") continue;
        for (let node of newNodes) {
          if (node.type === "reaction" && !removeReactionNodes.includes(node)) {
            // Direct cycle check - skip if bypassFilter is true
            if (!bypassFilter) {
              let chemicals = node.smiles.split(">>");
              let reactants = chemicals[0].split(".");
              for (let reactant of reactants) {
                if (p.smiles === reactant) {
                  removeReactionNodes.push(node);
                  break;
                }
              }
            }
            // Near cycle prevention
            if (this.filterNearCycles && !bypassFilter && !removeReactionNodes.includes(node)) {
              // map against the immediate parent reaction in display graph (i.e., the parent of the parentID node)
              this.ensureCoreFrags(parentNode);
              let chemicals = node.smiles.split(">>")[0];
              let smilesForCore = chemicals + ">>" + parentNode.coreFrags;
              const reactsToCoreFrags = await getCoreFragments(smilesForCore);
              node.reactsToCoreFrags = reactsToCoreFrags;

              // Propagate core fragments to child chemical nodes
              for (let react in reactsToCoreFrags) {
                // Find child chemical nodes that correspond to this reactant
                if (reactsToCoreFrags[react] == p.coreFrags) {
                  removeReactionNodes.push(node);
                  break;
                }
                for (let childNode of newNodes) {
                  if (childNode.type === "chemical" && childNode.smiles === react) {
                    // Check if this child is connected to the current reaction node
                    let isChildOfReaction = newEdges.some(
                      (edge) => edge.from === node.id && edge.to === childNode.id
                    );
                    if (isChildOfReaction) {
                      childNode.coreFrags = reactsToCoreFrags[react] || p.coreFrags;
                    }
                  }
                }
              }

            }
          }
          }
        }

      // Now, we will find the precursor nodes of those reactions
      let removeChemicalNodes = [];
      if (removeReactionNodes.length !== 0) {
        this.addRemovedReactions({
          dispID: parentId,
          removedReactions: removeReactionNodes,
        });
        for (let reactionNode of removeReactionNodes) {
          let parentToChildEdges = newEdges.filter(
            (edge) => edge.from === reactionNode.id
          );
          for (let parentToChildEdge of parentToChildEdges) {
            let childNode = newNodes.find(
              (node) => node.id === parentToChildEdge.to
            );
            removeChemicalNodes.push(childNode);
          }
        }

        for (let node of removeChemicalNodes) {
          newNodes = newNodes.filter((el) => el.id !== node.id);
        }

        for (let node of removeReactionNodes) {
          // IMPORTANT: Clean up inVis for filtered reactions
          let reactionSmiles = node.smiles;
          let reactionDataNode = this.dataGraph.nodes.get(reactionSmiles);
          if (reactionDataNode && reactionDataNode.inVis && parentId in reactionDataNode.inVis) {
            delete reactionDataNode.inVis[parentId];
          }

          // Remove from newNodes
          newNodes = newNodes.filter((el) => el.id !== node.id);
          // Remove from newEdges
          newEdges = newEdges.filter((el) => {
            if (el.from === node.id || el.to === node.id) {
              return false;
            }
            return true;
          });
        }
      }

      if (newNodes.length > 0) {
        this.addDispNodes(newNodes);
      }
      if (newEdges.length > 0) {
        this.addDispEdges(newEdges);
      }
    },
    async addResultsToDispGraph({ maxDepth, maxNum }) {
      // Add existing nodes from dataGraph to dispGraph
      // maxDepth indicates number of levels to add
      // maxNum indicates how many results to add per level
      let _helper = async (root, depth) => {
        if (depth > maxDepth) {
          return;
        }
        const rootNode = this.dispGraph.nodes.get(root);
        if (!rootNode) return;
        let smiles = rootNode["smiles"];
        let reactionIds = this.dataGraph.getSuccessors(smiles);
        let reactions = this.dataGraph.nodes.get(reactionIds).filter(Boolean);
        if (maxNum) {
          if (depth < maxDepth) {
            const hasDeeper = (rxn) =>
              rxn.precursors?.some((p) => this.dataGraph.getSuccessors(p).length > 0) ? 0 : 1;
            reactions = reactions.sort(
              (a, b) =>
                hasDeeper(a) - hasDeeper(b) ||
                (a["rank"] ?? Infinity) - (b["rank"] ?? Infinity)
            );
          } else {
            reactions = reactions.sort(
              (a, b) => (a["rank"] ?? Infinity) - (b["rank"] ?? Infinity)
            );
          }
          reactions = reactions.slice(0, maxNum);
        }
        reactions = reactions
          .filter((rxn) => !(root in rxn["inVis"]))
          .map((rxn) => rxn.id);

        if (reactions.length > 0) {
          await this.addRetroResultToDispGraph({
            data: reactions,
            parentId: root,
          });
        }

        for (const rxn of this.dispGraph.getSuccessors(root)) {
          for (const chem of this.dispGraph.getSuccessors(rxn)) {
            await _helper(chem, depth + 1);
          }
        }
      };

      return _helper(NIL_UUID, 1);
    },
    addTreeToDispGraph(data) {
      const settings = useSettingsStore();
      // This adds the provided pathway to the IPP display tree
      // Input pathway should be in nodelink json format
      let newNodes = data.nodes.filter((node) => {
        // Only add node if it is not already in the graph
        return this.dispGraph.nodes.get(node["id"]) === null;
      });
      let newEdges = data.edges.filter((edge) => {
        // Only add an edge if the target node is not already in the graph
        return this.dispGraph.edges.get(edge["id"]) === null;
      });

      this.updateDispNodes(
        newNodes.map((node) => {
          let dataObj = this.dataGraph.nodes.get(node["smiles"]);
          if (node.type === "chemical") {
            return makeChemicalDisplayNode({
              id: node["id"],
              data: dataObj,
              target: this.target,
              align: settings.alignNodeImagesToTarget,
            });
          } else {
            return makeReactionDisplayNode({
              id: node["id"],
              data: dataObj,
            });
          }
        })
      );

      this.updateDispEdges(
        newEdges.map((edge) => {
          let from = this.dispGraph.nodes.get(edge["from"]);
          let to = this.dispGraph.nodes.get(edge["to"]);
          let reactionObj;
          if (from["type"] === "reaction") {
            reactionObj = this.dataGraph.nodes.get(from["smiles"]);
          } else {
            reactionObj = this.dataGraph.nodes.get(to["smiles"]);
            reactionObj.inVis[from["id"]] = to["id"];

            this.updateReactionSmiles({
              newNode: reactionObj,
            });
          }

          return makeDisplayEdge({
            id: edge["id"],
            from: edge["from"],
            to: edge["to"],
            value: reactionObj["averageModelScore"],
          });
        })
      );
    },
    addTreeBuilderResultToDataGraph(data) {
      let templateIds = [];
      let chemicals = [];
      this.addDataNodes(
        data.nodes.map((node) => {
          if (node.type === "chemical") {
            chemicals.push(node["id"]);
            return {
              id: node["id"],
              asReactant: node["as_reactant"],
              asProduct: node["as_product"],
              // molwt: node["molwt"],
              ppg:
                node["purchase_price"] > 0
                  ? node["purchase_price"]
                  : "not buyable",
              source: node["source"] || getPricingProperty(node["properties"], ["source", "supplier"]) || "",
              properties: normalizePricingProperties(node["properties"]),
              leadTime: node["lead_time"] || getPricingProperty(node["properties"], ["lead_time", "availability"]) || "",
              smilesMatch: getPricingProperty(node["properties"], ["smiles_match"]) || null,
              terminal: node["terminal"],
              type: node["type"],
            };
          } else {
            if (node["tforms"]) {
              templateIds.push(...node["tforms"]);
            }
            const precursorSmiles = precursorSmilesFromRxn(node["smiles"]);
            const precursorProperties = node["precursor_properties"] || {};
            return {
              id: node["id"],
              modelMetadata: node["model_metadata"],
              rank: node["precursor_rank"],
              retroScore: node["precursor_score"],
              // model: node["retro_backend"],
              // trainingSet: node["retro_model_name"],
              ffScore: node["plausibility"],
              // forwardScore: node["forward_score"],
              // retroScore: node["template_score"],
              // templateScore: node["template"]?.template_score ?? undefined,
              // templateIds: node["tforms"],
              // templateSets: node["tsources"],
              precursors: precursorSmiles.split("."),
              precursorSmiles,
              // numExamples: node["num_examples"],
              // necessaryReagent:
              //   node["template"]?.necessary_reagent ?? undefined,
              numRings: precursorProperties["num_rings"],
              rmsMolwt: precursorProperties["rms_molwt"],
              scscore: precursorProperties["scscore"],
              className: node["class_name"],
              classNum: node["class_num"],
              type: node["type"],
              inVis: {},
            };
          }
        })
      );
      this.updateScscore(chemicals);
      this.apiTemplateCount(templateIds);
      this.apiTemplateSet(templateIds);
      this.addDataEdges(
        data.edges.map((edge) => {
          return {
            from: edge["from"],
            to: edge["to"],
          };
        })
      );
    },
    rerankPrecursors(parentSmiles) {
      // Update rank for nodes in dataGraph
      let successorIds = this.dataGraph.getSuccessors(parentSmiles);
      let successorNodes = this.dataGraph.nodes.get(successorIds);
      // Separate custom precursors (rank 0) from API-expanded precursors
      const customPrecursors = successorNodes.filter(node => node.rank === 0);
      const apiPrecursors = successorNodes.filter(node => node.rank !== 0);
      let updatedNodes = apiPrecursors
        .sort(retroScoreDescending)
        .map((node, index) => ({
          id: node.id,
          rank: index + 1,
          inVis: node.inVis, // Not modified, but included for updating dispGraph
        }));
      updatedNodes.push(...customPrecursors.map(node => ({
        id: node.id,
        rank: 0,
        inVis: node.inVis,
      })));
      this.updateDataNodes(updatedNodes);
      // Update rank label for corresponding nodes in dispGraph
      let parentDispIds = this.dispGraph.nodes.getIds({
        filter: (item) => item.smiles === parentSmiles,
      });
      let updatedDispNodes = [];
      parentDispIds.forEach((dispId) => {
        updatedDispNodes.push(
          ...updatedNodes
            .filter((node) => {
              if (this.removedReactions[dispId] === undefined) {
                return !!node.inVis[dispId];
              } else {
                // Filter for nodes which are included in dispGraph
                return (
                  !!node.inVis[dispId] &&
                  !this.removedReactions[dispId].includes(node.inVis[dispId])
                );
              }
            })
            .map((node) => ({
              id: node.inVis[dispId], // This is the id of the display node
              label: "#" + node["rank"],
            }))
        );
      });
      this.updateDispNodes(updatedDispNodes);
    },
    async requestRetro({ smiles }) {
      const settings = useSettingsStore();
      const url = "/api/tree-search/expand-one/call-async";
      const body = {
        smiles: smiles,
      };
      Object.assign(body, settings.interactive_path_planner_settings);
      // if (strategy.model === "template_relevance") {
      //   checkTemplatePrioritizers(body["template_prioritizers"]);
      // }
      // throw error if the strategies are not unique
      if (!checkUniqueStrategy(body.retro_backend_options)) {
        return {
          message: "Strategies must be unique",
          result: [],
        };
      }
      body.banned_chemicals = loadCollection("chemicals");
      body.banned_reactions = loadCollection("reactions");
      try {
        const response = await API.runCeleryTask(url, body);
        return response;
      } catch {
        return {
          message: "No precursor found",
          result: [],
        };
      }
    },
    async expand(nodeId) {
      // const createConfirm = useConfirm();
      if (typeof nodeId == "string" && nodeId.startsWith("cluster")) {
        throw new Error(
          "Cannot expand collapsed node! To toggle collapsed state, click collapse toggle button again with collapsed cluster selected."
        );
      }
      const node = this.dispGraph.nodes.get(nodeId);
      if (node.type !== "chemical") {
        throw new Error(
          "Cannot expand reaction; try expanding with a chemical node selected"
        );
      }
      const smiles = node.smiles;
      const settings = useSettingsStore();

      if (
        settings.interactive_path_planner_settings.retro_backend_options
          .length === 0
      ) {
        throw new Error("Please add atleast one strategy");
      }

      const strategyPromise = new Promise((resolve, reject) => {
        this.requestRetro({ smiles: smiles })
          .then((response) => {
            if (response.result === null || response.result.length === 0) {
              reject(new Error(response.message));
            } else {
              resolve(response);
            }
          })
          .catch(async (err) => {
            throw err;
          });
      });

      await strategyPromise
        .then(async (response) => {
          if (response.status_code === 500) {
            throw new Error(response.message);
          }
          const addedReactions = await this.addRetroResultToDataGraph({
            data: response.result,
            parentSmiles: smiles,
            nodeID: nodeId,
          });
          const reactionsToAdd = addedReactions.slice(0, settings.reactionLimit);
          if (reactionsToAdd.length === 0) {
            throw new Error(
              "All predicted reactions are already displayed for this node"
            );
          }
          await this.addRetroResultToDispGraph({
            data: reactionsToAdd,
            parentId: nodeId,
          });
        })
        .catch(async (err) => {
          throw err;
        });
    },
    async templateRelevance(smiles, selectedTemplate = "reaxys") {
      const settings = useSettingsStore();
      const url = "/api/retro/template-relevance/call-async";
      const body = {
        model_name: selectedTemplate,
        smiles: [smiles],
        // template_prioritizers: settings.tbSettings.templatePrioritizers,
        num_templates: settings.tbSettings.numTemplates,
        max_cum_prob: settings.tbSettings.maxCumProb,
        // return_templates: true,
        attribute_filter: [],
      };
      // checkTemplatePrioritizers(body["template_prioritizers"]);
      try {
        const output = await API.runCeleryTask(url, body);
        this.setRecTemplates({
          smiles: smiles,
          data: Object.fromEntries(
            output["result"][0].templates.map((item) => [item._id, item])
          ),
        });
        // Update templates with existing results
        let precursorSmiles = this.dataGraph.getSuccessors(smiles);
        let precursors = this.dataGraph.nodes.get(precursorSmiles);
        let results = {};
        for (let p of precursors) {
          if (p["templateIds"]) {
            for (let t of p["templateIds"]) {
              // If template settings were changed, results may include IDs which are not in recommended templates
              if (
                Object.prototype.hasOwnProperty.call(
                  this.recommendedTemplates[smiles],
                  t
                )
              ) {
                if (results[t] === undefined) {
                  results[t] = [p["precursorSmiles"]];
                } else {
                  results[t].push(p["precursorSmiles"]);
                }
              }
            }
          }
        }
        this.setRecTemplatesResults({ smiles: smiles, results: results });
      } catch (error) {
        console.error(
          "Could not retrieve template relevance prediction:",
          error
        );
      }
    },
    async applyTemplate({ smiles, template }) {
      const url = "/api/rdkit/apply-one-template-by-idx";
      const body = {
        smiles: smiles,
        template_idx: template.index,
        template_set: template.template_set,
      };
      API.post(url, body, true).then(async (json) => {
        try {
          const output = await API.pollCeleryResult(json.task_id);
          this.setRecTemplatesResults({
            smiles: smiles,
            results: {
              [template._id]: output.map((item) => item.precursors.join(".")),
            },
          });
        } catch (err) {
          alert(err);
          throw new Error(err);
        }
      });
    },
    async recluster(smiles) {
      const settings = useSettingsStore();
      let rxns = this.dataGraph.nodes
        .get(this.dataGraph.getSuccessors(smiles))
        .sort(retroScoreDescending);
      let outcomes = rxns.map((rxn) => rxn["precursorSmiles"].split(">>")[0]);
      let scores = rxns.map((rxn) => rxn["retroScore"] || 0);
      let url = "/api/cluster/call-async";
      let body = {
        original: smiles,
        outcomes: outcomes,
        feature:
          settings.interactive_path_planner_settings.cluster_setting.feature,
        cluster_method:
          settings.interactive_path_planner_settings.cluster_setting
            .cluster_method,
        fp_type:
          settings.interactive_path_planner_settings.cluster_setting.fp_type,
        fp_length:
          settings.interactive_path_planner_settings.cluster_setting.fp_length,
        fp_radius:
          settings.interactive_path_planner_settings.cluster_setting.fp_radius,
        scores: scores,
      };
      try {
        const json = await API.runCeleryTask(url, body);
        let clusterTracker = new Set();
        let updateData = [];
        rxns.forEach((rxn_2, i) => {
          let cid = json.result[0][i];
          updateData.push({
            id: rxn_2.id,
            clusterId: cid,
            clusterName: json.result[1][cid],
            clusterRep: !clusterTracker.has(cid),
          });
          clusterTracker.add(cid);
        });
        this.updateDataNodes(updateData);
      } catch (error) {
        alert(
          "按当前设置获取该目标的聚类结果时出错：" +
            error
        );
      }
    },
    updateTreeConnectivity() {
      this.setTreeNodeMap(generateTreeNodeMap(this.trees));
      this.setTreeEdgeMap(generateTreeEdgeMap(this.trees));
    },

    // mutations

    updateReactionSmiles({ newNode }) {
      this.dataGraph.nodes.updateOnly(newNode);
    },
    setTarget(target) {
      this.target = target;
    },
    addDataNodes(data) {
      this.$patch((state) => {
        state.dataGraph.nodes.add(data);
        state.recomputeData += 1;
      });
    },
    addDataEdges(data) {
      this.dataGraph.edges.add(data);
    },
    addDispNodes(data) {
      this.$patch((state) => {
        state.dispGraph.nodes.add(data);
        state.recomputeDisp += 1;
      });
    },
    addDispEdges(data) {
      this.$patch((state) => {
        state.dispGraph.edges.add(data);
        state.recomputeData += 1; // For changes to inVis
      });
    },
    clearDataGraph() {
      this.dataGraph.clear();
    },
    clearDispGraph() {
      this.dispGraph.clear();
    },
    clearRemovedReactions() {
      this.removedReactions = {};
    },
    deleteDataNode(node) {
      // For chemical nodes, delete direct successors (reactions)
      // For reaction nodes, delete the reaction node only
      // Also deletes the nodes and all successors from the dispGraph if applicable
      // May leave subgraphs which are disconnected from the main network
      // 1. Delete instances of this node and its successors from dispGraph
      let dispNodes = this.dispGraph.nodes.get({
        filter: (dn) => dn.smiles === node.id,
      });
      for (const dispNode of dispNodes) {
        this.deleteDispNode(dispNode);
      }
      // 2. If this is a chemical node, get its successors; otherwise, just get the node id
      let toDelete = isChemical(node)
        ? this.dataGraph.getSuccessors(node.id)
        : node.id;
      // 3. Delete nodes from dataGraph
      this.dataGraph.nodes.remove(toDelete);
      // 4. Delete any leftover edges
      this.dataGraph.trimDanglingEdges();
      this.recomputeData += 1;
    },
    deleteDispNode(node) {
      // For chemical nodes, delete all successors
      // For reaction nodes, delete the node and its successors
      // Also updates the inVis property for the corresponding nodes in dataGraph
      this.deleteDispNodefn(node);
      this.recomputeData += 1; // For changes to inVis
      this.recomputeDisp += 1;
    },
    deleteDispNodefn(node) {
      // 1. Get all successors to this node
      let toDelete = this.dispGraph.getAllSuccessors(node.id);
      // 2. If this is a reaction node, include it in the list
      if (isReaction(node)) {
        toDelete.push(node.id);
      }
      // 3. Get reaction nodes and update their inVis properties
      let reactionNodes = this.dispGraph.nodes.get(toDelete, {
        filter: isReaction,
      });
      for (const node of reactionNodes) {
        let dataObj = this.dataGraph.nodes.get(node.smiles);
        let predecessorId = this.dispGraph.getPredecessors(node.id)[0];
        delete dataObj.inVis[predecessorId];
      }
      // 4. Delete successors
      this.dispGraph.nodes.remove(toDelete);
      // 5. Delete any leftover edges
      this.dispGraph.trimDanglingEdges();
    },
    importDataJSON(data) {
      this.dataGraph.fromJSON(data);
      this.recomputeData += 1;
    },
    importDispJSON(data) {
      this.dispGraph.fromJSON(data);
      this.recomputeDisp += 1;
    },
    updateDataNodes(data) {
      this.$patch((state) => {
        state.dataGraph.nodes.update(data);
        state.recomputeData += 1;
      });
    },
    updateDataEdges(data) {
      this.dataGraph.edges.update(data);
    },
    updateDispNodes(data) {
      this.$patch((state) => {
        state.dispGraph.nodes.update(data);
        state.recomputeDisp += 1;
      });
    },
    updateDispEdges(data) {
      this.$patch((state) => {
        state.dispGraph.edges.update(data);
        state.recomputeData += 1; // For changes to inVis
      });
    },
    setRecTemplates({ smiles, data }) {
      this.recommendedTemplates[smiles] = data;
    },
    setRecTemplatesResults({ smiles, results }) {
      Object.entries(results).forEach(([template, data]) => {
        this.recommendedTemplates[smiles][template]["results"] = data;
      });
    },
    setSavedResultInfo(data) {
      this.savedResultInfo = data;
    },
    updateSavedResultInfo(data) {
      Object.assign(this.savedResultInfo, data);
    },
    setTrees(data) {
      this.trees = data;
    },
    setTreeNodeMap(data) {
      this.treeNodeMap = data;
    },
    setTreeEdgeMap(data) {
      this.treeEdgeMap = data;
    },
    addRemovedReactions({ dispID, removedReactions }) {
      this.removedReactions[dispID] = [];
      removedReactions.forEach((node) => {
        this.removedReactions[dispID].push(node.id);
      });
    },
    setfilterNearCycles(value) {
      this.filterNearCycles = value;
      localStorage.setItem('filterNearCycles', JSON.stringify(value));
    },
    ensureCoreFrags(node) {
      // Ensure node has coreFrags property, set to smiles if not present
      if (!node.coreFrags) {
        node.coreFrags = node.smiles;
      }
    },
  },
});

function convertUDS(resultObj) {
  let transformResult = {};
  (transformResult["graph"] = {}),
    (transformResult["paths"] = []),
    // paths
    resultObj.pathways.forEach((edges, idx) => {
      const uniqueIds = new Set();
      edges.forEach((edge) => {
        uniqueIds.add(edge.source);
        uniqueIds.add(edge.target);
      });

      const nodes = Array.from(uniqueIds).map((id) => {
        const smiles = resultObj.uuid2smiles[id] || "Unknown";
        const nodeInfo = resultObj.node_dict[smiles];

        return {
          id,
          smiles,
          type:
            nodeInfo?.type || (smiles.includes(">>") ? "reaction" : "chemical"),
        };
      });

      const transformedEdges = edges.map((edge) => ({
        from: edge.source,
        to: edge.target,
      }));

      let newPath = {
        directed: true,
        multigraph: false,
        graph: resultObj.pathways_properties[idx],
        nodes: nodes,
        edges: transformedEdges,
      };

      transformResult["paths"].push(newPath);
    });

  // graph
  const sampleEdge = resultObj.graph[0];
  const graphUsesUUIDs = sampleEdge && sampleEdge.source in resultObj.uuid2smiles;

  const uniqueSmiles = new Set();
  resultObj.graph.forEach((edge) => {
    const src = graphUsesUUIDs
      ? resultObj.uuid2smiles[edge.source] || edge.source
      : edge.source;
    const tgt = graphUsesUUIDs
      ? resultObj.uuid2smiles[edge.target] || edge.target
      : edge.target;
    uniqueSmiles.add(src);
    uniqueSmiles.add(tgt);
  });

  const nodes = Array.from(uniqueSmiles).map((smiles) => {
    const nodeInfo = resultObj.node_dict[smiles];

    return {
      ...nodeInfo,
      id: smiles,
    };
  });

  transformResult["graph"] = {
    directed: true,
    multigraph: false,
    graph: {},
    nodes: nodes,
    edges: resultObj.graph.map((edge) => ({
      from: graphUsesUUIDs
        ? resultObj.uuid2smiles[edge.source] || edge.source
        : edge.source,
      to: graphUsesUUIDs
        ? resultObj.uuid2smiles[edge.target] || edge.target
        : edge.target,
    })),
  };

  return transformResult;
}

function getUnifiedRoutePool(resultObj) {
  const pool = resultObj?.result?.unified_route_pool;
  if (!pool || !Array.isArray(pool.selected_routes)) {
    return null;
  }
  return pool;
}

function convertUnifiedRoutePool(unifiedRoutePool, canonicalTarget) {
  const transformResult = { graph: {}, paths: [] };
  const graphNodes = new Map();
  const graphEdges = [];
  const routeSource = (route) => route?.engine || route?.metadata?.source || "unified_route_pool";

  unifiedRoutePool.selected_routes.forEach((route, routeIndex) => {
    const engine = routeSource(route);
    const sourceLabel = sourceLabelFromEngine(engine);
    const routePrefix = `unified-${routeIndex + 1}`;
    const pathNodes = new Map();
    const pathEdges = [];

    const upsertChemical = (smiles, options = {}) => {
      if (!smiles) return null;
      if (pathNodes.has(smiles)) {
        return pathNodes.get(smiles);
      }
      const terminal = route.starting_materials?.includes(smiles) || options.terminal === true;
      const chemicalNode = {
        id: smiles,
        smiles,
        type: "chemical",
        terminal,
        purchase_price: terminal && route.closed ? 1 : 0,
        source: terminal ? (route.closure_sources || []).join(", ") : "",
        route_source_engine: engine,
        source_label: sourceLabel,
      };
      if (!graphNodes.has(smiles)) {
        graphNodes.set(smiles, chemicalNode);
      } else if (terminal) {
        graphNodes.set(smiles, { ...graphNodes.get(smiles), ...chemicalNode });
      }
      const pathId = `${routePrefix}-chem-${pathNodes.size + 1}`;
      const pathNode = { id: pathId, smiles, type: "chemical" };
      pathNodes.set(smiles, pathNode);
      return pathNode;
    };

    const upsertReaction = (step, stepIndex) => {
      const reactionSmiles = step.reaction_smiles || `${(step.precursors || []).join(".")}>>${step.product || canonicalTarget}`;
      if (pathNodes.has(reactionSmiles)) {
        return pathNodes.get(reactionSmiles);
      }
      const reactionNode = {
        id: reactionSmiles,
        smiles: reactionSmiles,
        type: "reaction",
        plausibility: step.confidence,
        model_metadata: step.metadata?.model_metadata || [],
        source: step.source,
        route_source_engine: engine,
        source_label: sourceLabel,
      };
      if (!graphNodes.has(reactionSmiles)) {
        graphNodes.set(reactionSmiles, reactionNode);
      }
      const pathNode = {
        id: `${routePrefix}-rxn-${stepIndex + 1}`,
        smiles: reactionSmiles,
        type: "reaction",
      };
      pathNodes.set(reactionSmiles, pathNode);
      return pathNode;
    };

    (route.steps || []).forEach((step, stepIndex) => {
      const productNode = upsertChemical(step.product || route.target_smiles || canonicalTarget, {
        terminal: false,
      });
      const reactionNode = upsertReaction(step, stepIndex);
      if (productNode && reactionNode) {
        pathEdges.push({ from: productNode.id, to: reactionNode.id });
        graphEdges.push({ from: productNode.smiles, to: reactionNode.smiles });
      }
      (step.precursors || []).forEach((precursor) => {
        const precursorNode = upsertChemical(precursor, {
          terminal: route.starting_materials?.includes(precursor),
        });
        if (reactionNode && precursorNode) {
          pathEdges.push({ from: reactionNode.id, to: precursorNode.id });
          graphEdges.push({ from: reactionNode.smiles, to: precursorNode.smiles });
        }
      });
    });

    if (!pathNodes.size) {
      upsertChemical(route.target_smiles || canonicalTarget, { terminal: false });
    }

    transformResult.paths.push({
      directed: true,
      multigraph: false,
      graph: {
        route_id: route.route_id,
        route_source_engine: engine,
        source_label: sourceLabel,
        score: route.route_score,
        num_reactions: route.steps?.length || 0,
        depth: route.steps?.length || 0,
        precursor_cost: null,
      },
      nodes: [...pathNodes.values()],
      edges: pathEdges,
    });
  });

  transformResult.graph = {
    directed: true,
    multigraph: false,
    graph: {},
    nodes: [...graphNodes.values()],
    edges: deduplicateEdges(graphEdges),
  };

  return transformResult;
}

function sourceLabelFromEngine(engine) {
  const value = String(engine || "").toLowerCase();
  if (value.includes("aizynth")) return "AiZynthFinder";
  if (value.includes("askcos")) return "ASKCOS";
  return "统一路线池";
}

function deduplicateEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.from}>>${edge.to}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function loadCollection(category) {
  let smiles = [];
  API.get(`/api/banlist/${category}/get`, null, false).then((json) => {
    json.forEach(function (val) {
      smiles.push(val.smiles);
    });
  });
  return smiles;
}

function checkUniqueStrategy(strategies) {
  const strategyDict = new Set();
  for (const strategy of strategies) {
    const strategyKey =
      strategy.retro_backend +
      "-" +
      strategy.retro_model_name +
      "-" +
      strategy.max_num_templates +
      "-" +
      strategy.max_cum_prob;
    if (strategyDict.has(strategyKey)) {
      return false;
    }
    strategyDict.add(strategyKey);
  }
  return true;
}

function generateTreeNodeMap(trees) {
  // Generates object to track node IDs which exist in a tree
  // Similar to inVis attribute of dataGraph reactions which tracks node IDs which exist in dispGraph
  // Returns an object like {smiles: {parentid: nodeid}}
  let nodeMap = {};
  for (let tree of trees) {
    let nodes = Object.fromEntries(
      tree.nodes.map((node) => [node["id"], node])
    );
    let succ = generateTreeEdgeMap([tree]);
    for (let node of tree.nodes) {
      let successors = succ[node["id"]];
      if (successors) {
        Object.keys(successors).forEach((s) => {
          let child = nodes[s];
          if (child["smiles"] in nodeMap) {
            nodeMap[child["smiles"]][node["id"]] = child["id"];
          } else {
            nodeMap[child["smiles"]] = { [node["id"]]: child["id"] };
          }
        });
      }
    }
  }
  return Object.freeze(nodeMap); // Prevent this from being reactive
}

function generateTreeEdgeMap(trees) {
  // Generates object to track edge IDs which exist in a tree
  // Similar to _succ attribute of dispGraph
  // Returns an object like {parentid: {nodeid: edgeid}}
  let connectivity = {};
  for (let tree of trees) {
    for (let edge of tree.edges) {
      if (edge.from in connectivity) {
        connectivity[edge.from][edge.to] = edge.id;
      } else {
        connectivity[edge.from] = { [edge.to]: edge.id };
      }
    }
  }
  return Object.freeze(connectivity); // Prevent this from being reactive
}

function assignEdgeIds(trees) {
  // Generates random IDs for all edges in the input tree
  // Edges between the same nodes will receive the same ID across different trees
  let connectivity = {};
  for (let tree of trees) {
    for (let edge of tree.edges) {
      if (edge.from in connectivity) {
        if (edge.to in connectivity[edge.from]) {
          edge.id = connectivity[edge.from][edge.to];
        } else {
          edge.id = uuidv4();
          connectivity[edge.from][edge.to] = edge.id;
        }
      } else {
        edge.id = uuidv4();
        connectivity[edge.from] = { [edge.to]: edge.id };
      }
    }
  }
  return Object.freeze(connectivity); // Prevent this from being reactive
}

function retroScoreDescending(a, b) {
  // Takes two data node objects as input and compares their retro scores
  // Use for sorting nodes by retroScore
  return b["retroScore"] - a["retroScore"];
}

async function getHistory(smiles, templateSets) {
  const url = "/api/historian/lookup-smiles-list/";
  const body = { smiles_list: smiles, template_sets: templateSets };
  const json = await API.post(url, body);
  return Object.fromEntries(
    Object.entries(json).map(([smi, data]) => [
      smi,
      {
        asReactant: data["as_reactant"],
        asProduct: data["as_product"],
      },
    ])
  );
}

async function getPrice(smiles, sources) {
  const json = await lookupBuyables(smiles, sources);
  return Object.fromEntries(
    smiles.map((smi) => [
      smi,
      json["result"][smi] || { ppg: "not buyable", source: "" },
    ])
  );
}

async function getScscore(smiles) {
  const url = "/api/scscore/batch/call-sync";
  const json = await API.post(url, { smiles });
  return Object.fromEntries(
    smiles.map((smi) => [smi, { scscore: json["result"][smi] }])
  );
}

// Utility to get core fragments for a chemical
async function getCoreFragments(smiles) {

  if (!smiles) {
    return null;
  }

  let mappedSmiles;
  try {
    const output = await API.post('/api/atom-map/controller/call-sync', {
      // rxnmapper gives error when mapping with *
      backend: "indigo",
      smiles: [smiles]
    });
    mappedSmiles = output.result[0];

  } catch {
    return {};
  }

  let mappedReacts = mappedSmiles.split(">>")[0].split(".");
  let reactsToCoreFrags = {}
  for (let react of mappedReacts) {
    try {
      const response = await API.post('/api/rdkit/get-core-fragment', { smiles: react });
      const coreFragment = response.core_fragment;
      const canonReact = response.canon_smiles;
      reactsToCoreFrags[canonReact] = coreFragment;
    } catch {
      // Error handling for core fragment retrieval
    }
  }
  return reactsToCoreFrags;
}
