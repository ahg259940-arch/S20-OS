'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const storage = require('./storage.js');
const preferences = require('./preferences.js');
const cryptoBackup = require('../app/web/backup-crypto.js');

const safeId = /^[a-z0-9](?:[a-z0-9_-]{0,46}[a-z0-9])?$/;
const MAX_RESTORE_BYTES = 32 * 1024 * 1024;

function validateExportPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      payload.format !== 'nexus-context-export-v1' || !payload.context || !payload.data ||
      !safeId.test(payload.context.userId || '') || !safeId.test(payload.context.universeId || '')) {
    throw new Error('Estrutura de exportação ou contexto inválido.');
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_RESTORE_BYTES) {
    throw new Error('A exportação excede o limite seguro de restauração temporária.');
  }
  const { memory, conversations, goals, tasks, preferences: contextPreferences } = payload.data;
  if (!memory || typeof memory !== 'object' || Array.isArray(memory) ||
      !Array.isArray(memory.experiences) || !Array.isArray(memory.knowledge) || !Array.isArray(memory.relationships)) {
    throw new Error('Coleções de memória inválidas.');
  }
  if (!Array.isArray(conversations) || conversations.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Histórico de conversa inválido.');
  }
  if (!goals || typeof goals !== 'object' || !Array.isArray(goals.active) || !Array.isArray(goals.completed) || !Array.isArray(goals.abandoned)) {
    throw new Error('Estrutura de objetivos inválida.');
  }
  if (!tasks || typeof tasks !== 'object' || !Array.isArray(tasks.pending) || !Array.isArray(tasks.completed) || !Array.isArray(tasks.cancelled)) {
    throw new Error('Estrutura de tarefas inválida.');
  }
  const hasText = (value, min = 0) => typeof value === 'string' && value.trim().length >= min && value.length <= 20000;
  const validDate = value => typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
  if (memory.experiences.some(item => !item || !hasText(item.description, 1) || !validDate(item.date)) ||
      memory.knowledge.some(item => !item || !hasText(item.topic, 1) || !hasText(item.information, 1) || !validDate(item.date)) ||
      memory.relationships.some(item => !item || !hasText(item.name, 1) || !hasText(item.description, 1) || !validDate(item.date))) {
    throw new Error('Registro de memória inválido.');
  }
  if (conversations.some(item => !hasText(item.role, 1) || !hasText(item.content) || !validDate(item.timestamp))) {
    throw new Error('Registro de conversa inválido.');
  }
  const validGoal = item => item && safeId.test(item.id || '') && hasText(item.title, 1) && hasText(item.description, 1) && Number.isFinite(item.progress) && item.progress >= 0 && item.progress <= 100 && ['active', 'completed', 'abandoned'].includes(item.status) && Array.isArray(item.history);
  const validTask = item => item && safeId.test(item.id || '') && safeId.test(item.goalId || '') && hasText(item.title, 1) && hasText(item.description, 1) && ['pending', 'in_progress', 'completed', 'cancelled'].includes(item.status) && Array.isArray(item.history);
  if ([...goals.active, ...goals.completed, ...goals.abandoned].some(item => !validGoal(item)) ||
      [...tasks.pending, ...tasks.completed, ...tasks.cancelled].some(item => !validTask(item))) {
    throw new Error('Registro de objetivo ou tarefa inválido.');
  }
  let validatedPreferences;
  try { validatedPreferences = preferences.validatePreferences(contextPreferences); }
  catch (_error) { throw new Error('Preferências da exportação inválidas.'); }
  return {
    memory: { experiences: memory.experiences, knowledge: memory.knowledge, relationships: memory.relationships },
    conversations: { conversations }, goals, tasks, preferences: validatedPreferences
  };
}

async function restoreExportToTemporaryDirectory(envelope, passphrase) {
  const payload = await cryptoBackup.decryptBackup(envelope, passphrase);
  const files = validateExportPayload(payload);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-restore-'));
  try {
    fs.chmodSync(directory, 0o700);
    const relativeFiles = {
      'memory/memories.json': files.memory,
      'memory/conversations.json': files.conversations,
      'goals/goals.json': files.goals,
      'tasks/tasks.json': files.tasks,
      'preferences/settings.json': files.preferences
    };
    for (const [relative, contents] of Object.entries(relativeFiles)) {
      storage.writeJsonAtomic(path.join(directory, relative), contents);
    }
    return {
      success: true,
      directory,
      files: Object.keys(relativeFiles),
      context: { userId: payload.context.userId, universeId: payload.context.universeId },
      restoredToTemporaryDirectory: true,
      realDataModified: false
    };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw new Error('A restauração temporária falhou; a pasta criada foi removida: ' + error.message);
  }
}

module.exports = { validateExportPayload, restoreExportToTemporaryDirectory };
