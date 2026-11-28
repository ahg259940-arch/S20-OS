const crypto = require("crypto");
const planning = require("./planning.js");
const ethics = require("./ethics.js");
const authorization = require("./authorization.js");
const audit = require("./audit.js");

const sensitiveActionPattern = /\b(apagar|excluir|cancelar|comprar|publicar|enviar|executar|implantar|substituir|delete|purchase|publish|send|execute|deploy|overwrite)\b/i;

function normalizeAlternative(alternative, index) {
  if (typeof alternative === "string") {
    return {
      id: `alternative_${index + 1}`,
      action: alternative,
      benefit: "Pode avançar a avaliação da situação.",
      risk: "O contexto pode estar incompleto.",
      consequence: "A proposta deve ser revista conforme novas evidências.",
      benefitScore: 5,
      riskScore: 4,
      ethicalConcern: "Confirmar impactos e pessoas afetadas.",
      reversible: true,
      verified: false
    };
  }
  if (!alternative || typeof alternative !== "object" || typeof alternative.action !== "string") return null;

  return {
    id: alternative.id || `alternative_${index + 1}`,
    action: alternative.action,
    benefit: alternative.benefit || "Benefício ainda não avaliado.",
    risk: alternative.risk || "Risco ainda não avaliado.",
    consequence: alternative.consequence || "Consequências ainda não avaliadas.",
    benefitScore: Number.isFinite(alternative.benefitScore) ? Math.max(0, Math.min(10, alternative.benefitScore)) : 5,
    riskScore: Number.isFinite(alternative.riskScore) ? Math.max(0, Math.min(10, alternative.riskScore)) : 5,
    ethicalConcern: alternative.ethicalConcern || "Verificar coerência com os princípios do N.E.X.U.S.",
    requiresApproval: alternative.requiresApproval === true,
    reversible: alternative.reversible !== false,
    verified: alternative.verified === true,
    isGenerative: alternative.isGenerative === true
  };
}

function defaultAlternatives(needsMoreInformation) {
  if (needsMoreInformation) {
    return [
      {
        id: "request_information",
        action: "Solicitar informações adicionais antes de decidir.",
        benefit: "Reduz decisões baseadas em suposições.",
        risk: "Pode atrasar a resposta.",
        consequence: "A decisão fica pendente até haver contexto suficiente.",
        benefitScore: 9,
        riskScore: 2,
        reversible: true
      },
      {
        id: "prepare_cautious_hypothesis",
        action: "Preparar uma hipótese provisória para revisão humana.",
        benefit: "Permite explorar caminhos sem afirmar certeza.",
        risk: "A hipótese pode influenciar a interpretação.",
        consequence: "A proposta permanece não executada até revisão.",
        benefitScore: 6,
        riskScore: 5,
        reversible: true,
        verified: false
      }
    ];
  }
  return [
    {
      id: "compare_options",
      action: "Comparar alternativas e seus efeitos antes de escolher.",
      benefit: "Expõe diferenças de benefício, risco e consequência.",
      risk: "A comparação pode deixar de fora fatores não observados.",
      consequence: "Produz recomendação revisável, sem executar ações.",
      benefitScore: 8,
      riskScore: 2,
      reversible: true
    },
    {
      id: "prepare_reversible_proposal",
      action: "Preparar uma proposta reversível para revisão humana.",
      benefit: "Transforma a análise em um próximo passo concreto.",
      risk: "A proposta depende da qualidade do contexto.",
      consequence: "Nenhuma mudança ocorre até aprovação explícita.",
      benefitScore: 7,
      riskScore: 3,
      reversible: true
    }
  ];
}

function makeDecision(situation, context = {}) {
  const plan = context.plan || planning.createPlan(situation);
  const analysis = context.analysis || plan.context || {};
  const ethicalEvaluation = context.ethics || ethics.evaluateSituation(situation);
  const uncertainty = analysis.uncertainty || (analysis.needsMoreInformation ? "high" : "medium");
  const needsMoreInformation = analysis.needsMoreInformation === true || plan.requiresMoreInformation === true;
  const suppliedAlternatives = Array.isArray(context.alternatives)
    ? context.alternatives
    : defaultAlternatives(needsMoreInformation);
  const generatedSuggestion = typeof context.generativeSuggestion === "string" && context.generativeSuggestion.trim()
    ? [{
      id: "generative_suggestion",
      action: "Revisar esta sugestão generativa: " + context.generativeSuggestion.trim(),
      benefit: "Pode oferecer uma interpretação adicional para revisão.",
      risk: "A resposta externa não foi verificada e pode conter erros.",
      consequence: "Não deve ser executada sem verificação e revisão humana.",
      benefitScore: 6,
      riskScore: 8,
      requiresApproval: true,
      reversible: true,
      verified: false,
      isGenerative: true
    }]
    : [];
  const alternatives = [...suppliedAlternatives, ...generatedSuggestion]
    .map(normalizeAlternative)
    .filter(Boolean)
    .map(alternative => {
      const ethicalReview = ethics.evaluateAlternative(alternative, { uncertainty });
      const score = ethicalReview.allowed
        ? Math.max(0, Math.min(10, alternative.benefitScore - alternative.riskScore * 0.5))
        : Number.NEGATIVE_INFINITY;
      return { ...alternative, score, ethicalReview, requiresHumanReview: ethicalReview.requiresHumanReview };
    })
    .sort((left, right) => right.score - left.score);

  const allowed = alternatives.filter(item => item.ethicalReview.allowed);
  const selectedAlternative = allowed[0] || null;
  const requiresHumanApproval = Boolean(selectedAlternative && (
    selectedAlternative.requiresHumanReview ||
    selectedAlternative.requiresApproval ||
    sensitiveActionPattern.test(selectedAlternative.action)
  ));
  const proposalId = crypto.createHash("sha256")
    .update(JSON.stringify({ situation, alternative: selectedAlternative }))
    .digest("hex");
  const authorizationResult = requiresHumanApproval
    ? authorization.verifyAuthorization({
      operation: "execute_decision",
      proposalId,
      contentDigest: authorization.digestContent(selectedAlternative),
      approval: context.approval
    })
    : { authorized: false, status: "not_requested" };

  const allBlocked = alternatives.length > 0 && allowed.length === 0;
  const decisionResult = {
    situation,
    plan,
    alternatives,
    selectedAlternative,
    decision: allBlocked
      ? "Bloqueada por regra ética; nenhuma alternativa será executada."
      : selectedAlternative?.action || "Solicitar informações antes de decidir.",
    reason: allBlocked
      ? "Todas as alternativas avaliadas violaram uma regra ética obrigatória."
      : selectedAlternative
        ? `Alternativas comparadas por benefício e risco; foram consideradas ${alternatives.length} opções.`
        : "Não havia alternativas válidas para comparar.",
    justification: selectedAlternative
      ? `${selectedAlternative.benefit} Risco: ${selectedAlternative.risk} Consequência: ${selectedAlternative.consequence}`
      : "A decisão precisa ser reavaliada com alternativas compatíveis.",
    uncertainty,
    requiresHumanApproval,
    authorizationStatus: requiresHumanApproval
      ? authorizationResult.status
      : "not_required_for_reversible_proposal",
    executionAllowed: false,
    recommendationOnly: true,
    ethicalStatus: allBlocked
      ? "blocked"
      : alternatives.some(item => item.requiresHumanReview) ? "human_review_required" : "locally_permitted_proposal",
    decidedAt: new Date().toISOString()
  };
  return audit.executeAudited("decision_evaluated", {
    status: allBlocked ? "blocked" : "evaluated",
    requiresHumanApproval
  }, () => decisionResult);
}

module.exports = {
  makeDecision,
  normalizeAlternative
};
