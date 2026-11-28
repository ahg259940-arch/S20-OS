const perception = require("./perception.js");
const analysis = require("./analysis.js");
const planning = require("./planning.js");
const decision = require("./decision.js");
const reflection = require("./reflection.js");
const memory = require("../memory/memory.js");
const audit = require("./audit.js");

function observeSituation(situation, source = "unknown") {
  return perception.observe(situation, source);
}

function evaluateSituation(situation) {
  return analysis.analyzeSituation(situation);
}

function considerActions(situation) {
  return planning.createPlan(situation);
}

function evaluateDecision(situation) {
  return decision.makeDecision(situation);
}

function reviewDecision(situation, previousDecision) {
  return reflection.reflectOnSituation(
    situation,
    previousDecision
  );
}

function initiate(situation, source = "internal") {
  return audit.executeAudited("autonomous_situation_evaluated", { source }, () => {
    // Defer persistence until context-based evaluation is complete.
    const observation = perception.observe(situation, source);
    const evaluation = evaluateSituation(situation);
    const plan = considerActions(situation);
    const persistence = memory.rememberExperience(
      "Informação recebida de " + source + ": " + situation
    );
    if (persistence?.success === false) return persistence;

    return {
      situation,
      source,
      observation,
      evaluation,
      plan,
      persistence,
      requiresHumanInput: plan.requiresMoreInformation,
      status: "initiative_evaluated",
      initiatedAt: new Date().toISOString()
    };
  });
}

module.exports = {
  observeSituation,
  evaluateSituation,
  considerActions,
  evaluateDecision,
  reviewDecision,
  initiate
};
