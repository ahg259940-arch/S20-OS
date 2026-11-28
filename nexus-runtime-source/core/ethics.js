const memory = require("../memory/memory.js");
const identityProvider = require("./identity-provider.js");

const principles = [
  "Honestidade",
  "Justiça",
  "Respeito",
  "Responsabilidade",
  "Coerência",
  "Consideração pelas consequências"
];

const prohibitedPatterns = [
  /\b(mentir|falsificar|fraudar|enganar|roubar|prejudicar|assediar|discriminar)\b/i,
  /\b(lie|falsify|defraud|deceive|steal|harm|harass|discriminate)\b/i,
  /\b(expor|divulgar|revelar)\b.{0,40}\b(senha|segredo|credencial|chave de api|token)\b/i,
  /\b(expose|reveal|publish)\b.{0,40}\b(password|secret|credential|api key|token)\b/i,
  /\b(apagar|excluir|destruir|sobrescrever)\b.{0,40}\b(memória|historico|dados|arquivo|backup)\b/i,
  /\b(delete|erase|destroy|overwrite)\b.{0,40}\b(memory|history|data|file|backup)\b/i
];

function evaluateSituation(situation) {
  const context = memory.buildContext(situation);
  const identityPrinciples = identityProvider.getIdentity().principles;
  return {
    situation,
    principles,
    identityPrinciples,
    previousExperiences: context.experiences,
    previousKnowledge: context.knowledge,
    evaluationQuestions: [
      "Quem pode ser afetado por esta situação?",
      "Quais são as possíveis consequências?",
      "Há conflito com honestidade, justiça, respeito, responsabilidade ou coerência?",
      "As perspectivas das pessoas afetadas foram consideradas?",
      "A informação é suficiente e verificável?"
    ],
    requiresFurtherEvaluation: context.totalResults === 0,
    evaluatedAt: new Date().toISOString()
  };
}

function evaluateAlternative(alternative, context = {}) {
  const text = [alternative?.action, alternative?.benefit, alternative?.risk,
    alternative?.consequence, alternative?.ethicalConcern]
    .filter(value => typeof value === "string")
    .join(" ");
  const lowerRiskScore = Number.isFinite(alternative?.riskScore) ? alternative.riskScore : 5;
  const matchedRule = prohibitedPatterns.find(pattern => pattern.test(text));
  const prohibitedByRule = Boolean(matchedRule);
  const uncertain = context.uncertainty === "high" ||
    context.uncertainty === "medium" ||
    alternative?.verified === false ||
    alternative?.isGenerative === true;
  const relevantRisk = lowerRiskScore >= 7 ||
    alternative?.reversible === false ||
    alternative?.requiresApproval === true ||
    /\b(apagar|excluir|cancelar|comprar|publicar|enviar|executar|implantar|substituir|delete|purchase|publish|send|execute|deploy|overwrite)\b/i.test(text);
  const requiresHumanReview = !prohibitedByRule && (uncertain || relevantRisk);

  return {
    allowed: !prohibitedByRule,
    blocked: prohibitedByRule,
    requiresHumanReview,
    status: prohibitedByRule
      ? "blocked_by_ethical_rule"
      : requiresHumanReview ? "requires_human_review" : "permitted_reversible_proposal",
    principlesApplied: [...new Set([...principles, ...identityProvider.getIdentity().principles])],
    matchedRule: prohibitedByRule ? "fundamental_integrity_or_harm_rule" : null,
    reason: prohibitedByRule
      ? "A alternativa conflita com uma regra ética obrigatória."
      : requiresHumanReview
        ? "A incerteza, o risco ou a falta de verificação exige revisão humana."
        : "A alternativa é uma proposta reversível e não viola as regras locais identificadas."
  };
}

function recordEthicalLearning(situation, conclusion) {
  const stored = memory.rememberKnowledge("Ética: " + situation, conclusion);
  return {
    situation,
    conclusion,
    duplicate: !stored.added,
    status: stored.added ? "ethical_learning_recorded" : "ethical_learning_already_recorded",
    recordedAt: stored.entry.date
  };
}

module.exports = {
  evaluateSituation,
  evaluateAlternative,
  recordEthicalLearning,
  principles
};
