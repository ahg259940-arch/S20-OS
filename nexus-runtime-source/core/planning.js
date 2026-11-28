const analysis = require("./analysis.js");

function createPlan(situation) {
  const context = analysis.analyzeSituation(situation);

  const plan = {
    situation,
    context,
    possibleActions: [],
    requiresMoreInformation: context.needsMoreInformation,
    createdAt: new Date().toISOString()
  };

  if (context.needsMoreInformation) {
    plan.possibleActions.push(
      "Buscar mais informações antes de decidir."
    );
  } else {
    plan.possibleActions.push(
      "Avaliar o contexto disponível.",
      "Considerar possíveis alternativas.",
      "Preparar uma decisão fundamentada."
    );
  }

  return plan;
}

module.exports = {
  createPlan
};
