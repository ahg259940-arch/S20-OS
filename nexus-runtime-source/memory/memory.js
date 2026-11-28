const path = require("path");
const storage = require("../core/storage.js");
const audit = require("../core/audit.js");
const authorization = require("../core/authorization.js");
const contextManager = require("../core/context-scope.js");

const memoryPath = path.join(__dirname, "memories.json");
const activeMemoryPath = () => contextManager.resolveDataPath("memory", memoryPath);
const DEFAULT_CONTEXT_LIMIT = 20;

function normalizeMemory(memory) {
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    throw new Error("O arquivo de memória não contém um objeto válido.");
  }
  for (const collection of ["experiences", "knowledge", "relationships"]) {
    if (memory[collection] === undefined) memory[collection] = [];
    if (!Array.isArray(memory[collection])) {
      throw new Error("A coleção " + collection + " da memória não é válida; os dados foram preservados.");
    }
  }
  return memory;
}

function loadMemory() {
  return normalizeMemory(storage.readJson(activeMemoryPath(), {
    experiences: [],
    knowledge: [],
    relationships: []
  }));
}

function saveMemory(data, approval) {
  const auth = authorization.verifyAuthorization({
    operation: "replace_memory_file",
    proposalId: "memory-file-replacement",
    contentDigest: authorization.digestContent(data),
    approval
  });
  return { success: false, status: auth.status, message: "A substituição integral do arquivo de memória está bloqueada." };
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function addUnique(collection, fields, values) {
  const normalizedValues = values.map(normalize);
  const existing = collection.find(item =>
    fields.every((field, index) => normalize(item[field]) === normalizedValues[index])
  );
  if (existing) return { added: false, entry: existing };

  const entry = {
    ...Object.fromEntries(fields.map((field, index) => [field, values[index]])),
    date: new Date().toISOString()
  };
  collection.push(entry);
  return { added: true, entry };
}

function rememberInCollection(collectionName, fields, values) {
  return audit.executeAudited("memory_entry_recorded", {
    category: collectionName
  }, () => storage.updateJson(activeMemoryPath(), {
    experiences: [],
    knowledge: [],
    relationships: []
  }, data => {
    const memory = normalizeMemory(data);
    const result = addUnique(memory[collectionName], fields, values);
    return { result, commit: result.added };
  }));
}

function rememberExperience(description) {
  return rememberInCollection("experiences", ["description"], [description]);
}

function rememberKnowledge(topic, information) {
  return rememberInCollection("knowledge", ["topic", "information"], [topic, information]);
}

function rememberRelationship(name, description) {
  return rememberInCollection("relationships", ["name", "description"], [name, description]);
}

function tokenize(value) {
  return normalize(value).split(/[^a-z0-9]+/).filter(token => token.length > 1);
}

function scoreMatch(query, item, category) {
  const searchable = category === "experiences"
    ? item.description
    : category === "knowledge"
      ? `${item.topic} ${item.information}`
      : `${item.name} ${item.description}`;
  const normalizedQuery = normalize(query);
  const normalizedText = normalize(searchable);
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return 0;

  const matched = terms.filter(term => normalizedText.includes(term)).length;
  const coverage = matched / terms.length;
  const phraseBonus = normalizedQuery.length > 2 && normalizedText.includes(normalizedQuery) ? 1 : 0;
  if (phraseBonus === 0 && coverage < 0.5) return 0;
  return coverage + phraseBonus;
}

function searchMemory(term = "", options = {}) {
  const data = loadMemory();
  const query = typeof term === "string" ? term : String(term ?? "");
  const limit = Number.isInteger(options.limit) && options.limit > 0
    ? options.limit
    : Infinity;
  const all = {};
  let totalCandidates = 0;

  for (const category of ["experiences", "knowledge", "relationships"]) {
    const scored = data[category]
      .map((item, index) => ({ item, index, score: scoreMatch(query, item, category) }))
      .filter(result => !query.trim() || result.score > 0)
      .sort((left, right) =>
        right.score - left.score ||
        String(right.item.date || "").localeCompare(String(left.item.date || "")) ||
        left.index - right.index
      );
    totalCandidates += scored.length;
    all[category] = scored.slice(0, limit).map(result => result.item);
  }

  return { ...all, totalCandidates };
}

function buildContext(term = "", options = {}) {
  const results = searchMemory(term, {
    ...options,
    limit: Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : DEFAULT_CONTEXT_LIMIT
  });
  return {
    searchTerm: term,
    experiences: results.experiences,
    knowledge: results.knowledge,
    relationships: results.relationships,
    totalResults: results.experiences.length + results.knowledge.length + results.relationships.length,
    totalCandidates: results.totalCandidates
  };
}

function reviewKnowledge(options = {}) {
  const data = loadMemory();
  const staleAfterDays = Number.isFinite(options.staleAfterDays)
    ? Math.max(0, options.staleAfterDays)
    : 365;
  const now = options.now instanceof Date ? options.now : new Date();
  const groups = new Map();

  for (const item of data.knowledge) {
    const key = normalize(item.topic);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const possibleConflicts = [];
  for (const entries of groups.values()) {
    const distinctInformation = new Set(entries.map(item => normalize(item.information)));
    if (entries.length > 1 && distinctInformation.size > 1) {
      possibleConflicts.push({
        topic: entries[0].topic,
        entries,
        requiresReview: true,
        reason: "Há registros diferentes para o mesmo tópico; isso pode indicar evolução ou contradição."
      });
    }
  }

  const staleBefore = now.getTime() - staleAfterDays * 24 * 60 * 60 * 1000;
  const potentiallyStale = data.knowledge.filter(item => {
    const timestamp = Date.parse(item.date);
    return Number.isFinite(timestamp) && timestamp < staleBefore;
  });

  return {
    possibleConflicts,
    potentiallyStale,
    status: possibleConflicts.length || potentiallyStale.length ? "review_recommended" : "no_review_needed",
    reviewedAt: now.toISOString()
  };
}

module.exports = {
  loadMemory,
  saveMemory,
  rememberExperience,
  rememberKnowledge,
  rememberRelationship,
  searchMemory,
  buildContext,
  reviewKnowledge
};
