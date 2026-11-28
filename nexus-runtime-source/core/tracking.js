const goals = require("./goals.js");
const tasks = require("./tasks.js");
const memory = require("../memory/memory.js");

const STALE_AFTER_DAYS = 7;

function inspectProgress() {
  const result = goals.reviewGoals();
  const report = result.goals.map(goal => ({
    id: goal.id,
    title: goal.title,
    status: goal.status,
    progress: goal.progress,
    lastUpdate: goal.updatedAt,
    needsAttention: goal.status === "active" && goal.progress === 0
  }));

  return {
    totalGoals: result.totalResults,
    activeGoals: result.active,
    completedGoals: result.completed,
    abandonedGoals: result.abandoned,
    goals: report,
    inspectedAt: new Date().toISOString()
  };
}

function evaluateProgress(now = new Date()) {
  const report = inspectProgress();
  const taskReport = tasks.reviewTasks();
  const attention = report.goals.filter(goal => goal.needsAttention);
  const staleBefore = now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const stalledTasks = taskReport.pending.filter(task => {
    if (task.status !== "in_progress") return false;
    const lastEvent = Array.isArray(task.history) ? task.history.at(-1) : null;
    const date = Date.parse(lastEvent?.date || task.startedAt || task.createdAt);
    return Number.isFinite(date) && date < staleBefore;
  });
  const suggestions = stalledTasks.map(task => ({
    taskId: task.id,
    title: task.title,
    suggestion: "Revisar o bloqueio, dividir a tarefa em passos menores ou registrar o motivo da espera.",
    requiresHumanReview: true
  }));

  const evaluation = {
    goalsInspected: report.totalGoals,
    goalsNeedingAttention: attention.length,
    tasksInspected: taskReport.totals.pending + taskReport.totals.completed + taskReport.totals.cancelled,
    stalledTasks: stalledTasks.length,
    observations: [],
    suggestions,
    evaluatedAt: now.toISOString()
  };

  if (attention.length > 0) {
    evaluation.observations.push("Existem objetivos ativos sem progresso registrado.");
  }
  if (report.completedGoals > 0) {
    evaluation.observations.push("Existem objetivos concluídos.");
  }
  if (report.totalGoals === 0) {
    evaluation.observations.push("Ainda não existem objetivos registrados.");
  }
  if (stalledTasks.length > 0) {
    evaluation.observations.push("Há tarefas pendentes sem atualização recente; recomenda-se revisão humana.");
  }

  return evaluation;
}

function recordProgress(goalId, progress, observation) {
  const result = goals.updateGoal(goalId, progress, observation);
  if (result.success) {
    memory.rememberExperience(
      "Acompanhamento de objetivo: " + result.goal.title + " | " + observation
    );
  }
  return result;
}

function reviewDevelopment() {
  const report = inspectProgress();
  const evaluation = evaluateProgress();
  const taskReport = tasks.reviewTasks();

  return {
    report,
    evaluation,
    tasks: taskReport,
    status: "development_review_completed",
    reviewedAt: new Date().toISOString()
  };
}

module.exports = {
  inspectProgress,
  evaluateProgress,
  recordProgress,
  reviewDevelopment
};
