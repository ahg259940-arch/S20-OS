const tasks = require("./tasks.js");

function startTask(taskId) {
  return tasks.startTask(taskId);
}

function updateTaskProgress(taskId, progress, observation) {
  return tasks.updateTaskProgress(taskId, progress, observation);
}

function finishTask(taskId, evidence) {
  const current = tasks.loadTasks().pending.find(item => item.id === taskId);
  if (!current || current.status !== "in_progress") {
    return { success: false, message: "A tarefa precisa estar em execução para ser concluída." };
  }
  return tasks.completeTask(taskId, evidence, { execution: true });
}

function inspectExecution(taskId) {
  const data = tasks.loadTasks();
  const task = data.pending.find(item => item.id === taskId) ||
    data.completed.find(item => item.id === taskId);
  if (!task) return { success: false, message: "Tarefa não encontrada." };
  return { success: true, task, inspectedAt: new Date().toISOString() };
}

module.exports = {
  startTask,
  updateTaskProgress,
  finishTask,
  inspectExecution
};
