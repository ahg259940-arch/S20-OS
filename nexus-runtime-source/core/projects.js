'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const storage = require('./storage.js');
const audit = require('./audit.js');
const contextScope = require('./context-scope.js');

const repositoryRoot = path.resolve(__dirname, '..');
const fallbackProjectsRoot = path.join(repositoryRoot, 'workspace', 'projects');
const emptyRegistry = { version: 1, projects: [] };
const MAX_PROJECTS = 300;
const MAX_HISTORY = 30;
const kinds = new Set(['general', 'tool', 'game', 'experiment']);
const statuses = new Set(['active', 'archived']);
const idPattern = /^[a-f0-9-]{36}$/;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function validText(value, max, allowEmpty = false) {
  return typeof value === 'string' && value.length <= max &&
    (allowEmpty || value.trim().length > 0) && !/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
}
function normalizeProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project) || !idPattern.test(project.id) ||
      !validText(project.name, 120) || !validText(project.description, 6000, true) ||
      !kinds.has(project.kind) || !statuses.has(project.status) ||
      !Number.isInteger(project.revision) || project.revision < 1 ||
      !Array.isArray(project.history) || project.history.length > MAX_HISTORY ||
      typeof project.createdAt !== 'string' || typeof project.updatedAt !== 'string') {
    throw new Error('O registro de projeto está inválido; os dados foram preservados.');
  }
  for (const event of project.history) {
    if (!event || typeof event !== 'object' || !Number.isInteger(event.revision) ||
        !validText(event.action, 40) || !validText(event.summary, 240) || typeof event.at !== 'string') {
      throw new Error('O histórico do projeto está inválido; os dados foram preservados.');
    }
  }
  return project;
}
function normalizeRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 ||
      !Array.isArray(value.projects) || value.projects.length > MAX_PROJECTS) {
    throw new Error('O armazenamento de projetos está inválido; os dados foram preservados.');
  }
  const ids = new Set();
  for (const project of value.projects) {
    normalizeProject(project);
    if (ids.has(project.id)) throw new Error('O armazenamento contém IDs de projeto duplicados.');
    ids.add(project.id);
  }
  return value;
}
function getProjectPaths(create = false) {
  const current = contextScope.getCurrentContext();
  const allowedRoot = current ? path.join(repositoryRoot, 'contexts') : repositoryRoot;
  if (current && create) contextScope.ensureCurrentDataRoot();
  const projectsRoot = contextScope.resolveDataPath('projects', fallbackProjectsRoot);
  contextScope.assertSafeDescendant(projectsRoot, allowedRoot);
  const registryPath = path.join(projectsRoot, 'projects.json');
  contextScope.assertSafeDescendant(registryPath, allowedRoot);
  if (create) {
    fs.mkdirSync(projectsRoot, { recursive: true, mode: 0o700 });
    contextScope.assertSafeDescendant(projectsRoot, allowedRoot);
  }
  for (const target of [projectsRoot, registryPath]) {
    try {
      const stats = fs.lstatSync(target);
      if (stats.isSymbolicLink() || (target === projectsRoot ? !stats.isDirectory() : !stats.isFile())) {
        throw new Error('O caminho de projetos contém um tipo de arquivo não permitido.');
      }
      const real = fs.realpathSync(target);
      const allowedReal = fs.realpathSync(allowedRoot);
      if (real !== allowedReal && !real.startsWith(allowedReal + path.sep)) {
        throw new Error('O caminho real de projetos saiu do contexto permitido.');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { projectsRoot, registryPath };
}
function loadRegistry() {
  const { registryPath } = getProjectPaths(false);
  if (!fs.existsSync(registryPath)) return clone(emptyRegistry);
  return normalizeRegistry(storage.readJson(registryPath, emptyRegistry));
}
function listProjects({ status } = {}) {
  const registry = loadRegistry();
  if (status !== undefined && !statuses.has(status)) return { success: false, status: 'invalid_project_status', projects: [] };
  const projects = status ? registry.projects.filter(project => project.status === status) : registry.projects;
  return { success: true, projects: clone(projects).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
}
function getProject(id) {
  if (typeof id !== 'string' || !idPattern.test(id)) return null;
  return clone(loadRegistry().projects.find(project => project.id === id) || null);
}
function appendHistory(project, action, summary, now) {
  project.revision += 1;
  project.updatedAt = now;
  project.history.push({ revision: project.revision, action, summary, at: now });
  project.history = project.history.slice(-MAX_HISTORY);
}
function createProject(input = {}) {
  if (!validText(input.name, 120) || !validText(input.description ?? '', 6000, true) ||
      !kinds.has(input.kind || 'general')) return { success: false, status: 'invalid_project' };
  return audit.executeAudited('project_created', { kind: input.kind || 'general' }, () => {
    const paths = getProjectPaths(true);
    return storage.updateJson(paths.registryPath, clone(emptyRegistry), raw => {
      const registry = normalizeRegistry(raw);
      if (registry.projects.length >= MAX_PROJECTS) return { commit: false, result: { success: false, status: 'project_limit_reached' } };
      const now = new Date().toISOString();
      const project = {
        id: crypto.randomUUID(), name: input.name.trim(), description: (input.description || '').trim(),
        kind: input.kind || 'general', status: 'active', revision: 1, createdAt: now, updatedAt: now,
        history: [{ revision: 1, action: 'created', summary: 'Projeto criado.', at: now }]
      };
      registry.projects.push(project);
      return { result: { success: true, project: clone(project) } };
    });
  });
}
function updateProject(id, input = {}) {
  if (typeof id !== 'string' || !idPattern.test(id) ||
      (input.name !== undefined && !validText(input.name, 120)) ||
      (input.description !== undefined && !validText(input.description, 6000, true)) ||
      (input.kind !== undefined && !kinds.has(input.kind))) return { success: false, status: 'invalid_project_update' };
  return audit.executeAudited('project_updated', { projectId: id }, () => {
    const { registryPath } = getProjectPaths(true);
    return storage.updateJson(registryPath, clone(emptyRegistry), raw => {
      const registry = normalizeRegistry(raw);
      const project = registry.projects.find(item => item.id === id);
      if (!project) return { commit: false, result: { success: false, status: 'project_not_found' } };
      if (project.status !== 'active') return { commit: false, result: { success: false, status: 'project_archived' } };
      if (input.name !== undefined) project.name = input.name.trim();
      if (input.description !== undefined) project.description = input.description.trim();
      if (input.kind !== undefined) project.kind = input.kind;
      appendHistory(project, 'updated', 'Informações do projeto atualizadas.', new Date().toISOString());
      return { result: { success: true, project: clone(project) } };
    });
  });
}
function changeProjectStatus(id, status) {
  if (typeof id !== 'string' || !idPattern.test(id) || !statuses.has(status)) return { success: false, status: 'invalid_project_status' };
  return audit.executeAudited(status === 'archived' ? 'project_archived' : 'project_restored', { projectId: id }, () => {
    const { registryPath } = getProjectPaths(true);
    return storage.updateJson(registryPath, clone(emptyRegistry), raw => {
      const registry = normalizeRegistry(raw);
      const project = registry.projects.find(item => item.id === id);
      if (!project) return { commit: false, result: { success: false, status: 'project_not_found' } };
      if (project.status === status) return { commit: false, result: { success: true, project: clone(project), unchanged: true } };
      project.status = status;
      appendHistory(project, status, status === 'archived' ? 'Projeto arquivado.' : 'Projeto restaurado.', new Date().toISOString());
      return { result: { success: true, project: clone(project) } };
    });
  });
}
function archiveProject(id) { return changeProjectStatus(id, 'archived'); }
function restoreProject(id) { return changeProjectStatus(id, 'active'); }
function deleteProject(id, confirmation) {
  if (typeof id !== 'string' || !idPattern.test(id) || !validText(confirmation, 120)) {
    return { success: false, status: 'project_deletion_confirmation_required' };
  }
  const existing = getProject(id);
  if (!existing) return { success: false, status: 'project_not_found' };
  if (existing.status !== 'archived') return { success: false, status: 'archive_before_delete' };
  if (confirmation !== existing.name) return { success: false, status: 'project_deletion_confirmation_required' };
  return audit.executeAudited('project_deleted', { projectId: id }, () => {
    const { registryPath } = getProjectPaths(true);
    return storage.updateJson(registryPath, clone(emptyRegistry), raw => {
      const registry = normalizeRegistry(raw);
      const index = registry.projects.findIndex(project => project.id === id);
      if (index < 0) return { commit: false, result: { success: false, status: 'project_not_found' } };
      if (registry.projects[index].status !== 'archived') return { commit: false, result: { success: false, status: 'archive_before_delete' } };
      if (registry.projects[index].name !== confirmation) return { commit: false, result: { success: false, status: 'project_deletion_confirmation_required' } };
      registry.projects.splice(index, 1);
      return { result: { success: true, deleted: true } };
    });
  });
}

module.exports = { listProjects, getProject, createProject, updateProject, archiveProject, restoreProject, deleteProject };
