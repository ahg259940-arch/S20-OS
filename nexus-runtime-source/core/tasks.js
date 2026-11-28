const path = require("path");
const crypto = require("crypto");
const memory = require("../memory/memory.js");
const goals = require("./goals.js");
const storage = require("./storage.js");
const authorization = require("./authorization.js");
const audit = require("./audit.js");
const contextManager = require("./context-scope.js");

const tasksPath = path.join(__dirname, "../tasks/tasks.json");
const activeTasksPath = () => contextManager.resolveDataPath("tasks", tasksPath);
const emptyTasks = { pending: [], completed: [], cancelled: [] };

function normalizeTasks(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("O arquivo de tarefas não contém um objeto válido.");
  for (const key of Object.keys(emptyTasks)) {
    if (data[key] === undefined) data[key] = [];
    if (!Array.isArray(data[key])) throw new Error(`A seção ${key} das tarefas é inválida.`);
  }
  return data;
}

function loadTasks() {
  return normalizeTasks(storage.readJson(activeTasksPath(), emptyTasks));
}

function saveTasks(_data, approval) {
  const request = authorization.verifyAuthorization({
    operation: "replace_tasks_file",
    proposalId: "tasks-file-replacement",
    contentDigest: authorization.digestContent(_data),
    approval
  });
  return { success: false, status: request.status, message: "A substituição direta do arquivo de tarefas está bloqueada." };
}

function createTask(goalId, title, description) {
  return audit.executeAudited("task_created", { identifier: goalId }, () => {
    const goal = goals.loadGoals().active.find(item => item.id === goalId);
    if (!goal) return { success: false, message: "Objetivo ativo não encontrado." };
    if (typeof title !== "string" || !title.trim() ||
        typeof description !== "string" || !description.trim()) {
      return { success: false, message: "Título e descrição são obrigatórios." };
    }
    const task = {
      id: crypto.randomUUID(),
      goalId,
      title: title.trim(),
      description: description.trim(),
      status: "pending",
      createdAt: new Date().toISOString(),
      completedAt: null,
      history: []
    };
    storage.updateJson(activeTasksPath(), emptyTasks, raw => normalizeTasks(raw).pending.push(task));
    const remembered = memory.rememberExperience("Tarefa criada: " + task.title);
    if (remembered?.success === false) return { success: false, status: "memory_audit_failed", task };
    return task;
  });
}

function startTask(taskId) {
  return audit.executeAudited("task_execution_started", { identifier: taskId }, () => {
    const result = storage.updateJson(activeTasksPath(), emptyTasks, raw => {
      const data = normalizeTasks(raw);
      const task = data.pending.find(item => item.id === taskId);
      if (!task) return { commit: false, result: { success: false, message: "Tarefa pendente não encontrada." } };
      if (task.status === "in_progress") return { commit: false, result: { success: false, message: "Essa tarefa já está em execução." } };
      task.status = "in_progress";
      task.startedAt = new Date().toISOString();
      task.progress = 0;
      task.history.push({ event: "started", date: new Date().toISOString() });
      return { result: { success: true, task } };
    });
    if (result.success) memory.rememberExperience("Início da execução da tarefa: " + result.task.title);
    return result;
  });
}

function updateTaskProgress(taskId, progress, observation) {
  if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 99) {
    return { success: false, message: "O progresso deve ser um número entre 0 e 99." };
  }
  if (typeof observation !== "string" || observation.trim().length < 3) {
    return { success: false, message: "Informe uma observação sobre o progresso." };
  }
  return audit.executeAudited("task_progress_updated", { identifier: taskId }, () => {
    const result = storage.updateJson(activeTasksPath(), emptyTasks, raw => {
      const data = normalizeTasks(raw);
      const task = data.pending.find(item => item.id === taskId);
      if (!task || task.status !== "in_progress") {
        return { commit: false, result: { success: false, message: "A tarefa não está em execução." } };
      }
      task.progress = progress;
      task.history.push({ event: "progress_updated", progress, observation: observation.trim(), date: new Date().toISOString() });
      return { result: { success: true, task } };
    });
    if (result.success) memory.rememberExperience("Progresso da tarefa " + result.task.title + ": " + progress + "%. " + observation.trim());
    return result;
  });
}

function completeTask(taskId, evidence, options = {}) {
  if (typeof evidence !== "string" || evidence.trim().length < 5) {
    return { success: false, message: "É necessário registrar uma evidência da conclusão." };
  }
  return audit.executeAudited("task_completed", { identifier: taskId }, () => {
    const result = storage.updateJson(activeTasksPath(), emptyTasks, raw => {
      const data = normalizeTasks(raw);
      const index = data.pending.findIndex(task => task.id === taskId);
      if (index === -1) return { commit: false, result: { success: false, message: "Tarefa pendente não encontrada." } };
      const task = data.pending.splice(index, 1)[0];
      if (options.execution === true) {
        task.history.push({ event: "execution_finished", evidence: evidence.trim(), date: new Date().toISOString() });
      }
      task.status = "completed";
      task.completedAt = new Date().toISOString();
      task.history.push({ event: "completed", evidence: evidence.trim(), date: new Date().toISOString() });
      data.completed.push(task);
      return { result: { success: true, task } };
    });
    if (result.success) memory.rememberExperience("Tarefa concluída: " + result.task.title + " | Evidência: " + evidence.trim());
    return result;
  });
}

function cancelTask(taskId, reason, approval) {
  if (!contextManager.getCurrentContext()) {
    const proposal = { taskId, reason: String(reason || "") };
    const authorizationResult = authorization.verifyAuthorization({
      operation: "cancel_task",
      proposalId: taskId,
      contentDigest: authorization.digestContent(proposal),
      approval
    });
    if (!authorizationResult.authorized) {
      return { success: false, status: authorizationResult.status, message: authorizationResult.reason };
    }
  }
  return audit.executeAudited("task_cancelled", { identifier: taskId }, () => storage.updateJson(activeTasksPath(), emptyTasks, raw => {
    const data = normalizeTasks(raw);
    const index = data.pending.findIndex(task => task.id === taskId);
    if (index === -1) return { commit: false, result: { success: false, message: "Tarefa pendente não encontrada." } };
    const task = data.pending.splice(index, 1)[0];
    task.status = "cancelled";
    task.cancellationReason = reason;
    data.cancelled.push(task);
    return { result: { success: true, task } };
  }));
}

function reviewTasks(goalId = null) {
  const data = loadTasks();
  const filter = task => goalId === null || task.goalId === goalId;
  const pending = data.pending.filter(filter);
  const completed = data.completed.filter(filter);
  const cancelled = data.cancelled.filter(filter);
  return { pending, completed, cancelled, totals: { pending: pending.length, completed: completed.length, cancelled: cancelled.length } };
}

function planGoalInternal(goalId) {
  const goalData = goals.loadGoals();
  const goal = [...goalData.active, ...goalData.completed, ...goalData.abandoned].find(item => item.id === goalId);
  if (!goal) return { success: false, message: "Objetivo não encontrado." };
  if (goal.status !== "active") return { success: false, message: "Somente objetivos ativos podem receber novas tarefas." };

  const steps = [
    { title: "Pesquisar informações sobre: " + goal.title, description: "Investigar informações, possibilidades e conhecimentos relacionados ao objetivo." },
    { title: "Definir etapas para: " + goal.title, description: "Organizar as ações necessárias e estabelecer uma sequência de execução." },
    { title: "Registrar resultados de: " + goal.title, description: "Documentar descobertas, resultados e aprendizados relacionados ao objetivo." }
  ];
  const result = storage.updateJson(activeTasksPath(), emptyTasks, raw => {
    const data = normalizeTasks(raw);
    const existing = [...data.pending, ...data.completed, ...data.cancelled].filter(task => task.goalId === goalId);
    const created = [];
    for (const step of steps) {
      if (existing.some(task => task.title === step.title)) continue;
      const task = {
        id: crypto.randomUUID(), goalId, title: step.title, description: step.description,
        status: "pending", createdAt: new Date().toISOString(), completedAt: null, history: []
      };
      data.pending.push(task);
      existing.push(task);
      created.push(task);
    }
    return { result: { created, createdCount: created.length } };
  });
  if (result.createdCount > 0) memory.rememberExperience("Planejamento automático criado para o objetivo: " + goal.title + ". Quantidade de tarefas: " + result.createdCount);
  return {
    success: true,
    goal: goal.title,
    createdCount: result.createdCount,
    tasks: result.created,
    message: result.createdCount > 0 ? "Planejamento criado com sucesso." : "As tarefas planejadas já existem."
  };
}

function planGoal(goalId) {
  return audit.executeAudited("goal_tasks_planned", { identifier: goalId }, () => planGoalInternal(goalId));
}

module.exports = {
  loadTasks,
  saveTasks,
  createTask,
  startTask,
  updateTaskProgress,
  completeTask,
  cancelTask,
  reviewTasks,
  planGoal
};
