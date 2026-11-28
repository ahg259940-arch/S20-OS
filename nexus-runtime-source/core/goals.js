const path = require("path");
const crypto = require("crypto");
const memory = require("../memory/memory.js");
const storage = require("./storage.js");
const authorization = require("./authorization.js");
const audit = require("./audit.js");
const contextManager = require("./context-scope.js");

const goalsPath = path.join(__dirname, "../goals/goals.json");
const activeGoalsPath = () => contextManager.resolveDataPath("goals", goalsPath);
const emptyGoals = { active: [], completed: [], abandoned: [] };

function normalizeGoals(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("O arquivo de objetivos não contém um objeto válido.");
  }
  for (const key of Object.keys(emptyGoals)) {
    if (data[key] === undefined) data[key] = [];
    if (!Array.isArray(data[key])) throw new Error(`A seção ${key} dos objetivos é inválida.`);
  }
  return data;
}

function loadGoals() {
  return normalizeGoals(storage.readJson(activeGoalsPath(), emptyGoals));
}

function saveGoals(data, approval) {
  const auth = authorization.verifyAuthorization({
    operation: "replace_goals_file",
    proposalId: "goals-file-replacement",
    contentDigest: authorization.digestContent(data),
    approval
  });
  return { success: false, status: auth.status, message: "A substituição integral do arquivo de objetivos está bloqueada." };
}

function createGoal(title, description, reason, approval) {
  const proposal = { title, description, reason };
  const proposalId = crypto.createHash("sha256").update(JSON.stringify(proposal)).digest("hex");
  if (!contextManager.getCurrentContext()) {
    const authorizationResult = authorization.verifyAuthorization({
      operation: "create_goal",
      proposalId,
      contentDigest: authorization.digestContent(proposal),
      approval
    });
    if (!authorizationResult.authorized) {
      return {
        success: false,
        status: authorizationResult.status,
        message: authorizationResult.reason
      };
    }
  }

  return audit.executeAudited("goal_created", { proposalId }, () => {
  const goal = {
    id: crypto.randomUUID(),
    title,
    description,
    reason,
    status: "active",
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    history: []
  };
  storage.updateJson(activeGoalsPath(), emptyGoals, raw => {
    const data = normalizeGoals(raw);
    data.active.push(goal);
  });
  memory.rememberExperience("Objetivo criado: " + title + " | Descrição: " + description);
  return goal;
  });
}

function updateGoal(goalId, progress, observation) {
  const updatedProgress = Math.max(0, Math.min(100, Number(progress)));
  if (!Number.isFinite(updatedProgress)) {
    return { success: false, message: "Progresso inválido." };
  }
  if (updatedProgress >= 100 && !contextManager.getCurrentContext()) {
    const proposal = { goalId, progress: updatedProgress, observation };
    const auth = authorization.verifyAuthorization({
      operation: "complete_goal",
      proposalId: goalId,
      contentDigest: authorization.digestContent(proposal)
    });
    if (!auth.authorized) {
      return { success: false, status: auth.status, message: auth.reason };
    }
  }

  return audit.executeAudited("objective_progress_updated", { identifier: goalId }, () =>
  storage.updateJson(activeGoalsPath(), emptyGoals, raw => {
    const data = normalizeGoals(raw);
    const index = data.active.findIndex(goal => goal.id === goalId);
    if (index === -1) {
      return { commit: false, result: { success: false, message: "Objetivo ativo não encontrado." } };
    }
    const goal = data.active[index];
    goal.progress = updatedProgress;
    goal.updatedAt = new Date().toISOString();
    goal.history.push({ progress: updatedProgress, observation, date: new Date().toISOString() });
    if (updatedProgress >= 100) {
      goal.status = "completed";
      data.completed.push(goal);
      data.active.splice(index, 1);
    }
    return { result: { success: true, goal } };
  }));
}

function abandonGoal(goalId, reason, approval) {
  const current = loadGoals().active.find(goal => goal.id === goalId);
  if (!current) return { success: false, message: "Objetivo ativo não encontrado." };
  if (!contextManager.getCurrentContext()) {
    const proposal = { goalId, reason: String(reason || "") };
    const authorizationResult = authorization.verifyAuthorization({
      operation: "abandon_goal",
      proposalId: goalId,
      contentDigest: authorization.digestContent(proposal),
      approval
    });
    if (!authorizationResult.authorized) {
      return { success: false, status: authorizationResult.status, message: authorizationResult.reason };
    }
  }

  return audit.executeAudited("goal_abandoned", { identifier: goalId }, () =>
  storage.updateJson(activeGoalsPath(), emptyGoals, raw => {
    const data = normalizeGoals(raw);
    const index = data.active.findIndex(goal => goal.id === goalId);
    if (index === -1) return { commit: false, result: { success: false, message: "Objetivo ativo não encontrado." } };
    const goal = data.active.splice(index, 1)[0];
    goal.status = "abandoned";
    goal.abandonReason = reason;
    goal.updatedAt = new Date().toISOString();
    data.abandoned.push(goal);
    return { result: { success: true, goal } };
  }));
}

function reconsiderGoal(goalId, newInformation) {
  const goal = loadGoals().active.find(item => item.id === goalId);
  if (!goal) return { success: false, message: "Objetivo não encontrado." };
  return {
    goal,
    newInformation,
    questions: [
      "Este objetivo ainda faz sentido?",
      "As circunstâncias mudaram?",
      "Existem alternativas melhores?",
      "O objetivo continua coerente com suas experiências?",
      "Deve manter, modificar ou abandonar o objetivo?"
    ],
    reconsiderationRequired: true,
    evaluatedAt: new Date().toISOString()
  };
}

function reviewGoals(term = "") {
  const data = loadGoals();
  const search = String(term || "").toLowerCase();
  const allGoals = [...data.active, ...data.completed, ...data.abandoned];
  const matchingGoals = allGoals.filter(goal => {
    const content = [goal.title, goal.description, goal.reason].join(" ").toLowerCase();
    return !search || content.includes(search);
  });
  return {
    goals: matchingGoals,
    active: data.active.length,
    completed: data.completed.length,
    abandoned: data.abandoned.length,
    totalResults: matchingGoals.length
  };
}

module.exports = {
  loadGoals,
  saveGoals,
  createGoal,
  updateGoal,
  abandonGoal,
  reconsiderGoal,
  reviewGoals
};
