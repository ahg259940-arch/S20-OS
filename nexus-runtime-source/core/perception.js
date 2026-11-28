const memory = require("../memory/memory.js");

function createPerception(input, source) {
  return {
    input,
    source,
    receivedAt: new Date().toISOString()
  };
}

function perceive(input, source = "unknown") {
  const perception = createPerception(input, source);

  const persistence = memory.rememberExperience(
    "Informação recebida de " + source + ": " + input
  );

  return { ...perception, persistence };
}

function observe(input, source = "unknown") {
  const perception = createPerception(input, source);

  return {
    perception,
    context: memory.buildContext(input)
  };
}

function inspect(input, source = "unknown") {
  // Capture prior context before recording this input, so it cannot be
  // returned as a remembered experience of its own analysis.
  const observation = observe(input, source);
  const saved = memory.rememberExperience(
    "Informação recebida de " + source + ": " + input
  );

  return {
    ...observation,
    persistence: saved
  };
}

module.exports = {
  perceive,
  inspect,
  observe
};
