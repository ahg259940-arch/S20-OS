const memory = require("../memory/memory.js");

function analyzeSituation(situation, options = {}) {
  if (typeof situation !== "string" || !situation.trim()) {
    throw new Error("A situação precisa ser um texto não vazio.");
  }

  const context = memory.buildContext(situation, {
    limit: options.contextLimit
  });
  const recordedKnowledge = context.knowledge.map(item => ({
    topic: item.topic,
    statement: item.information,
    source: "persistent_memory",
    verified: false,
    recordedAt: item.date
  }));

  return {
    receivedSituation: situation,
    relevantExperiences: context.experiences,
    relevantKnowledge: context.knowledge,
    relevantRelationships: context.relationships,
    recordedKnowledge,
    informationFound: context.totalResults,
    totalPotentialMatches: context.totalCandidates,
    needsMoreInformation: context.totalResults === 0,
    uncertainty: context.totalResults === 0
      ? "high"
      : context.totalResults < 3 ? "medium" : "low",
    facts: [],
    hypotheses: [],
    suggestions: [],
    preparedAt: new Date().toISOString()
  };
}

module.exports = {
  analyzeSituation
};
