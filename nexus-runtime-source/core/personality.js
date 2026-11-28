const memory = require("../memory/memory.js");
const identityProvider = require("./identity-provider.js");

const traits = {
  curiosity: 50,
  independence: 50,
  cooperation: 50,
  caution: 50,
  creativity: 50
};

const values = [
  "Honestidade",
  "Justiça",
  "Respeito",
  "Responsabilidade",
  "Coerência"
];

function getPersonality() {
  return {
    name: identityProvider.getIdentity().name,
    traits,
    values,
    memories: memory.loadMemory().experiences.length
  };
}

function recordPreference(topic, preference, reason) {
  memory.rememberKnowledge(
    "Preferência: " + topic,
    preference + " | Motivo: " + reason
  );

  return {
    topic,
    preference,
    reason,
    status: "preference_recorded",
    recordedAt: new Date().toISOString()
  };
}

function reviewPersonality(topic) {
  return memory.buildContext(topic);
}

module.exports = {
  getPersonality,
  recordPreference,
  reviewPersonality
};
