const path = require("path");
const storage = require("./storage.js");
const audit = require("./audit.js");
const contextScope = require("./context-scope.js");

const fallbackPath = path.join(__dirname, "../config/preferences.json");
const preferencesPath = () => contextScope.resolveDataPath("preferences", fallbackPath);
const panels = ["memory", "goals", "reasoning", "security", "workspace"];
const defaultPreferences = Object.freeze({
  version: 1,
  theme: "nexus-dark",
  reducedMotion: false,
  panels: { memory: true, goals: true, reasoning: true, security: true, workspace: false },
  layout: {
    portrait: ["core", "chat", "memory", "goals", "reasoning", "security", "workspace"],
    landscape: ["core", "chat", "reasoning", "goals", "memory", "security", "workspace"]
  },
  workspace: { zoom: 1, panX: 0, panY: 0, nodes: {} }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 ||
      !["nexus-dark"].includes(value.theme) || typeof value.reducedMotion !== "boolean" ||
      !value.panels || typeof value.panels !== "object" || Array.isArray(value.panels) ||
      !value.layout || typeof value.layout !== "object" || Array.isArray(value.layout) ||
      !value.workspace || typeof value.workspace !== "object" || Array.isArray(value.workspace)) {
    throw new Error("As preferências do contexto estão inválidas; os dados foram preservados.");
  }
  for (const panel of panels) if (typeof value.panels[panel] !== "boolean") throw new Error("Visibilidade de painel inválida.");
  for (const orientation of ["portrait", "landscape"]) {
    const order = value.layout[orientation];
    if (!Array.isArray(order) || order.length !== panels.length + 2 ||
        new Set(order).size !== order.length || !order.includes("core") || !order.includes("chat") ||
        order.some(item => !["core", "chat", ...panels].includes(item))) {
      throw new Error("Ordem de painéis inválida.");
    }
  }
  const workspace = value.workspace;
  if (!Number.isFinite(workspace.zoom) || workspace.zoom < 0.7 || workspace.zoom > 1.6 ||
      !Number.isFinite(workspace.panX) || (workspace.panX < -4000 || workspace.panX > 0) ||
      !Number.isFinite(workspace.panY) || (workspace.panY < -16000 || workspace.panY > 0) ||
      !workspace.nodes || typeof workspace.nodes !== "object" || Array.isArray(workspace.nodes) ||
      Object.keys(workspace.nodes).length > 200) throw new Error("Estado do espaço de trabalho inválido.");
  for (const [id, node] of Object.entries(workspace.nodes)) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !node || typeof node !== "object" ||
        !Number.isFinite(node.x) || !Number.isFinite(node.y) ||
        node.x < 0 || node.x > 2400 || node.y < 0 || node.y > 10000 ||
        !Number.isFinite(node.width) || node.width < 180 || node.width > 700) {
      throw new Error("Posição de componente inválida.");
    }
  }
  return value;
}

function loadPreferences() {
  const current = contextScope.getCurrentContext();
  if (!current) return clone(defaultPreferences);
  return normalizePreferences(storage.readJson(preferencesPath(), clone(defaultPreferences)));
}

function savePreferences(candidate) {
  if (!contextScope.getCurrentContext()) {
    return { success: false, status: "context_required", message: "Selecione um contexto autenticado para salvar preferências." };
  }
  let validated;
  try {
    validated = normalizePreferences(candidate);
  } catch (_error) {
    return { success: false, status: "invalid_preferences", message: "As preferências não passaram pela validação." };
  }
  return audit.executeAudited("context_preferences_updated", {}, () =>
    storage.updateJson(preferencesPath(), clone(defaultPreferences), raw => {
      if (raw?.version !== 1) throw new Error("Versão de preferências incompatível.");
      return { data: clone(validated), result: { success: true, preferences: clone(validated) } };
    })
  );
}

function resetPreferences() {
  return savePreferences(clone(defaultPreferences));
}

module.exports = { loadPreferences, savePreferences, resetPreferences, validatePreferences: value => clone(normalizePreferences(value)), defaultPreferences: clone(defaultPreferences) };
