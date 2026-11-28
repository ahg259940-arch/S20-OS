const memory = require("../memory/memory.js");

function reflectOnSituation(situation, decision) {
  const context = memory.buildContext(situation);

  const reflection = {
    situation,
    previousDecision: decision,
    memoriesReviewed: context.totalResults,

    reflectionQuestions: [
      "As informações disponíveis eram suficientes?",
      "Quais foram as consequências dessa decisão?",
      "Existem outras interpretações possíveis?",
      "A decisão foi coerente com os princípios conhecidos?",
      "O que pode ser aprendido com essa experiência?"
    ],

    requiresReevaluation: context.totalResults === 0,
    reflectedAt: new Date().toISOString()
  };

  return reflection;
}

function recordReflection(situation, conclusion) {
  memory.rememberExperience(
    "Reflexão sobre: " + situation +
    " | Conclusão: " + conclusion
  );

  return {
    situation,
    conclusion,
    status: "reflection_recorded",
    recordedAt: new Date().toISOString()
  };
}

module.exports = {
  reflectOnSituation,
  recordReflection
};
