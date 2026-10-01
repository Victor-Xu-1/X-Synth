export const RETRO_BACKEND_CATALOG = [
  {
    value: "template_relevance",
    title: "template_relevance",
    defaultTrainingSet: "reaxys",
    trainingSets: [
      "reaxys",
      "pistachio",
      "pistachio_ringbreaker",
      "reaxys_biocatalysis",
      "bkms_metabolic",
      "cas",
      "uspto_higher_level",
    ],
  },
  {
    value: "augmented_transformer",
    title: "augmented_transformer",
    defaultTrainingSet: "pistachio_23Q3",
    trainingSets: ["pistachio_23Q3", "USPTO_FULL"],
  },
  {
    value: "graph2smiles",
    title: "graph2smiles",
    defaultTrainingSet: "pistachio_23Q3",
    trainingSets: ["pistachio_23Q3", "USPTO_FULL"],
  },
  {
    value: "retrosim",
    title: "retrosim",
    defaultTrainingSet: "USPTO_FULL",
    trainingSets: ["USPTO_FULL", "bkms"],
  },
  {
    value: "exact_match",
    title: "exact_match",
    defaultTrainingSet: "USPTO_FULL",
    trainingSets: ["USPTO_FULL", "bkms"],
  },
  {
    value: "template_enumeration",
    title: "template_enumeration",
    defaultTrainingSet: "USPTO_50k",
    trainingSets: ["USPTO_50k", "retrobiocat"],
  },
];

function normalizeBackendName(name) {
  return name?.startsWith("retro_") ? name.replace(/^retro_/, "") : name;
}

function getStatusByBackend(modelStatus = []) {
  return new Map(
    modelStatus
      .filter((item) => item?.name?.startsWith("retro_"))
      .map((item) => [normalizeBackendName(item.name), item])
  );
}

function getStatusText(status) {
  if (!status) return "待检测";
  if (status.ready) return "运行中";
  if (status.to_start) return "未启动";
  return "未启用";
}

function getRuntimeTrainingSetsByBackend(runtimeCapabilities = null) {
  const trainingSetsByBackend = new Map();
  for (const model of runtimeCapabilities?.retrosynthesis_models ?? []) {
    const backend = normalizeBackendName(model?.backend ?? model?.service);
    const trainingSet = model?.id ?? model?.name ?? model?.value;
    if (!backend || !trainingSet) continue;
    if (!trainingSetsByBackend.has(backend)) {
      trainingSetsByBackend.set(backend, new Set());
    }
    trainingSetsByBackend.get(backend).add(trainingSet);
  }
  return trainingSetsByBackend;
}

export function buildRetroBackendCatalog(runtimeCapabilities = null) {
  const runtimeTrainingSets = getRuntimeTrainingSetsByBackend(runtimeCapabilities);
  const configuredModels = new Set(RETRO_BACKEND_CATALOG.map((entry) => entry.value));
  const catalog = RETRO_BACKEND_CATALOG.map((entry) => {
    const trainingSets = new Set(entry.trainingSets);
    for (const trainingSet of runtimeTrainingSets.get(entry.value) ?? []) {
      trainingSets.add(trainingSet);
    }
    return {
      ...entry,
      trainingSets: Array.from(trainingSets),
    };
  });

  for (const [backend, trainingSets] of runtimeTrainingSets.entries()) {
    if (configuredModels.has(backend)) continue;
    const firstTrainingSet = Array.from(trainingSets)[0];
    catalog.push({
      value: backend,
      title: backend,
      defaultTrainingSet: firstTrainingSet,
      trainingSets: Array.from(trainingSets),
    });
  }

  return catalog;
}

function getCatalogEntry(backend, runtimeCapabilities = null) {
  return buildRetroBackendCatalog(runtimeCapabilities).find(
    (item) => item.value === backend
  );
}

function getTrainingSetsForBackend(backend, status, runtimeCapabilities = null) {
  const catalogEntry = getCatalogEntry(backend, runtimeCapabilities);
  const sets = new Set(catalogEntry?.trainingSets ?? []);
  for (const name of status?.available_model_names ?? []) {
    sets.add(name);
  }
  return Array.from(sets);
}

export function getRetroModelItems(modelStatus = [], runtimeCapabilities = null) {
  const statusByBackend = getStatusByBackend(modelStatus);
  const catalog = buildRetroBackendCatalog(runtimeCapabilities);
  const configuredModels = catalog.map((entry) => entry.value);
  const statusOnlyModels = Array.from(statusByBackend.keys()).filter(
    (backend) => !configuredModels.includes(backend)
  );

  return [...configuredModels, ...statusOnlyModels].map((backend) => {
    const catalogEntry = getCatalogEntry(backend, runtimeCapabilities);
    const status = statusByBackend.get(backend);
    const statusText = getStatusText(status);
    const title = catalogEntry?.title ?? backend;

    return {
      title: `${title} · ${statusText}`,
      value: backend,
      ready: Boolean(status?.ready),
      statusText,
      backendUrl: status?.backend_url ?? "",
      props: { disabled: false },
    };
  });
}

export function getRetroTrainingSetItems(
  backend,
  modelStatus = [],
  runtimeCapabilities = null
) {
  const status = getStatusByBackend(modelStatus).get(backend);
  const statusText = getStatusText(status);

  return getTrainingSetsForBackend(backend, status, runtimeCapabilities).map(
    (trainingSet) => ({
      title: `${trainingSet} · ${statusText}`,
      value: trainingSet,
      ready: Boolean(status?.ready),
      statusText,
      props: { disabled: false },
    })
  );
}

export function getDefaultRetroTrainingSet(
  backend,
  modelStatus = [],
  runtimeCapabilities = null
) {
  const catalogEntry = getCatalogEntry(backend, runtimeCapabilities);
  if (catalogEntry?.defaultTrainingSet) return catalogEntry.defaultTrainingSet;

  return getTrainingSetsForBackend(
    backend,
    getStatusByBackend(modelStatus).get(backend),
    runtimeCapabilities
  )[0];
}
