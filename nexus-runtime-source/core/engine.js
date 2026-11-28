const crypto = require("crypto");
const identityProvider = require("./identity-provider.js");
const perception = require("./perception.js");
const analysis = require("./analysis.js");
const reasoning = require("./reasoning.js");
const planning = require("./planning.js");
const decision = require("./decision.js");
const reflection = require("./reflection.js");
const personality = require("./personality.js");
const ethics = require("./ethics.js");
const emotions = require("./emotions.js");
const autonomy = require("./autonomy.js");
const goals = require("./goals.js");
const initiative = require("./initiative.js");
const tracking = require("./tracking.js");
const tasks = require("./tasks.js");
const execution = require("./execution.js");
const learning = require("./learning.js");
const development = require("./development.js");
const audit = require("./audit.js");
const contracts = require("./contracts.js");
const memory = require("../memory/memory.js");

function safeAuditDetails(source, extra = {}) {
  return { source: String(source || "unknown").slice(0, 80), ...extra };
}

async function processSituationCore(situation, source, options) {
  const observation = perception.observe(situation, source);
  const analysisResult = analysis.analyzeSituation(situation);
  const reasoningResult = reasoning.analyzeSituation(situation);
  const personalityState = personality.getPersonality();
  const ethicalEvaluation = ethics.evaluateSituation(situation);
  const emotionalInterpretation = emotions.interpretEmotion(situation);
  const currentGoals = goals.reviewGoals();
  const currentTasks = tasks.reviewTasks();
  const progressReport = tracking.inspectProgress();
  const actionPlan = planning.createPlan(situation);

  // The model response is an unverified suggestion, never a fact or authorization.
  const enrichedReasoning = await reasoning.enrichWithIntelligence(
    situation,
    reasoningResult,
    {
      analysis: analysisResult,
      ethics: {
        principles: ethicalEvaluation.principles,
        evaluationQuestions: ethicalEvaluation.evaluationQuestions,
        requiresFurtherEvaluation: ethicalEvaluation.requiresFurtherEvaluation
      },
      plan: actionPlan,
      activeGoals: currentGoals.goals.filter(goal => goal.status === "active"),
      pendingTasks: currentTasks.pending,
      progress: progressReport
    },
    options
  );

  const decisionResult = decision.makeDecision(situation, {
    analysis: analysisResult,
    ethics: ethicalEvaluation,
    plan: actionPlan,
    alternatives: options.alternatives,
    generativeSuggestion: enrichedReasoning.generative.status === "available"
      ? enrichedReasoning.generative.answer
      : null,
    approval: options.approval
  });
  if (decisionResult.success === false) {
    throw new Error("A decisão não foi registrada; consulte a auditoria.");
  }
  const reflectionResult = reflection.reflectOnSituation(situation, decisionResult.decision);

  const interactionPersistence = options.persistGenerative === false
    ? { deferred: true, historySaved: false, memorySaved: false }
    : reasoning.persistGenerativeInteraction(situation, enrichedReasoning);
  if (enrichedReasoning.generative.status === "available") {
    enrichedReasoning.generative.persistence = interactionPersistence;
  }

  const received = memory.rememberExperience("Informação recebida de " + source + ": " + situation);
  const processed = memory.rememberExperience("Situação processada pelo núcleo: " + situation);
  if (received?.success === false || processed?.success === false) {
    throw new Error("A memória não confirmou a gravação; consulte auditoria e armazenamento.");
  }

  return {
    identity: identityProvider.getIdentity(),
    situation,
    observation,
    analysis: analysisResult,
    reasoning: enrichedReasoning,
    personality: personalityState,
    ethics: ethicalEvaluation,
    emotionalInterpretation,
    goals: currentGoals,
    tasks: currentTasks,
    progress: progressReport,
    actionPlan,
    decision: decisionResult,
    reflection: reflectionResult,
    uncertainty: decisionResult.uncertainty,
    status: "integrated_processing_completed",
    processedAt: new Date().toISOString()
  };
}

async function processSituation(situation, source = "unknown", options = {}) {
  let started;
  try {
    started = audit.recordEvent("situation_processing_started", safeAuditDetails(source));
  } catch (_error) {
    return {
      success: false,
      status: "audit_unavailable",
      operationPerformed: false,
      message: "O processamento foi bloqueado porque a auditoria não pôde ser iniciada."
    };
  }

  let result;
  try {
    result = await processSituationCore(situation, source, options || {});
  } catch (_error) {
    try {
      audit.recordEvent("situation_processing_failed", {
        operationId: started.id,
        ...safeAuditDetails(source),
        status: "processing_failed"
      });
    } catch (_auditError) {
      return {
        success: false,
        status: "audit_failure_unrecorded",
        operationPerformed: true,
        message: "O processamento falhou e a falha não pôde ser registrada."
      };
    }
    return {
      success: false,
      status: "processing_failed",
      operationPerformed: true,
      message: "O processamento local falhou; consulte a auditoria."
    };
  }

  try {
    audit.recordEvent("situation_processing_completed", {
      operationId: started.id,
      ...safeAuditDetails(source, {
        decision: result.decision.decision,
        requiresHumanApproval: result.decision.requiresHumanApproval,
        generativeStatus: result.reasoning.generative.status
      })
    });
  } catch (_error) {
    return {
      success: false,
      status: "audit_completion_unrecorded",
      operationPerformed: true,
      operationMayHaveCompleted: true,
      result,
      message: "O resultado não pode ser declarado concluído porque a auditoria final falhou."
    };
  }

  return {
    ...result,
    traceId: started.id,
    auditRecorded: true,
    warnings: []
  };
}

async function processInput(input, options = {}) {
  const normalized = contracts.normalizeSituationInput(input);
  if (!normalized.success) return normalized;
  const result = await processSituation(normalized.situation, normalized.source, options);
  if (result.success === false) return result;
  return contracts.createResultEnvelope(result, normalized.source);
}

function initiateAutonomousEvaluation(situation) {
  return autonomy.initiate(situation, "internal");
}

function evaluateAutonomousOpportunities() {
  return audit.executeAudited("autonomy_opportunities_reviewed", {}, () => initiative.evaluateOpportunities());
}

function considerAutonomousInitiative() {
  return audit.executeAudited("initiative_proposed", {}, () => initiative.considerInitiative());
}

function startAutonomousInitiative(approval) {
  return initiative.startInitiative(approval);
}

function inspectDevelopment() {
  return tracking.reviewDevelopment();
}

function inspectTasks(goalId = null) {
  return tasks.reviewTasks(goalId);
}

function planGoal(goalId) {
  return tasks.planGoal(goalId);
}

function updateObjective(goalId, progress, observation) {
  return tracking.recordProgress(goalId, progress, observation);
}

function startTaskExecution(taskId) {
  return execution.startTask(taskId);
}

function updateTaskExecution(taskId, progress, observation) {
  return execution.updateTaskProgress(taskId, progress, observation);
}

function finishTaskExecution(taskId, evidence) {
  return execution.finishTask(taskId, evidence);
}

function inspectTaskExecution(taskId) {
  return execution.inspectExecution(taskId);
}

function recordLearningOutcome(result) {
  return learning.recordOutcome(result);
}

function reviewMemory(term = "") {
  return {
    context: memory.buildContext(term),
    knowledgeReview: memory.reviewKnowledge()
  };
}

function proposeProject(details) {
  return development.proposeProject(details);
}

function createProject(proposal, approval) {
  return development.createProject(proposal, approval);
}

function validateProject(slug) {
  return development.validateProject(slug);
}

function inspectActivity(limit) {
  return audit.readEvents({ limit });
}

module.exports = {
  processSituation,
  processInput,
  initiateAutonomousEvaluation,
  evaluateAutonomousOpportunities,
  considerAutonomousInitiative,
  startAutonomousInitiative,
  inspectDevelopment,
  inspectTasks,
  planGoal,
  updateObjective,
  startTaskExecution,
  updateTaskExecution,
  finishTaskExecution,
  inspectTaskExecution,
  recordLearningOutcome,
  reviewMemory,
  proposeProject,
  createProject,
  validateProject,
  inspectActivity
};
