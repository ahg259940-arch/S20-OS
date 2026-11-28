const fs = require("fs");
const path = require("path");
const { AsyncLocalStorage } = require("async_hooks");

const repositoryRoot = path.resolve(__dirname, "..");
const contextsRoot = path.join(repositoryRoot, "contexts");
const asyncContext = new AsyncLocalStorage();
const dataFiles = Object.freeze({
  memory: path.join("memory", "memories.json"),
  conversations: path.join("memory", "conversations.json"),
  goals: path.join("goals", "goals.json"),
  tasks: path.join("tasks", "tasks.json"),
  activity: path.join("activity", "events.jsonl"),
  projects: path.join("workspace", "projects"),
  preferences: path.join("preferences", "settings.json")
});

function getCurrentContext() {
  return asyncContext.getStore() || null;
}

function getCurrentDataRoot() {
  return asyncContext.getStore()?.dataRoot || null;
}

function runWithContext(context, callback) {
  return asyncContext.run(context, callback);
}

function assertSafeDescendant(targetPath, allowedRoot) {
  const root = path.resolve(allowedRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("O caminho solicitado está fora do contexto autorizado.");
  }

  let current = root;
  const rootStats = fs.lstatSync(current);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("A raiz do contexto não é um diretório seguro.");
  }
  const realRoot = fs.realpathSync(current);
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") return target;
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error("Links simbólicos não são permitidos nos dados do contexto.");
    const realCurrent = fs.realpathSync(current);
    if (realCurrent !== realRoot && !realCurrent.startsWith(realRoot + path.sep)) {
      throw new Error("O caminho real saiu do contexto autorizado.");
    }
    if (current !== target && !stats.isDirectory()) {
      throw new Error("Um diretório pai do contexto não é diretório.");
    }
  }
  return target;
}

function resolveDataPath(area, legacyPath) {
  const current = asyncContext.getStore();
  if (!current) return legacyPath;
  const relative = dataFiles[area];
  if (!relative) throw new Error("Área de dados de contexto desconhecida.");
  const target = path.join(current.dataRoot, relative);
  const relativeToUser = path.relative(current.dataRoot, target);
  if (relativeToUser === ".." || relativeToUser.startsWith(".." + path.sep) || path.isAbsolute(relativeToUser)) {
    throw new Error("O caminho solicitado saiu do universo ativo.");
  }
  assertSafeDescendant(target, contextsRoot);
  return target;
}

function ensureCurrentDataRoot() {
  const current = asyncContext.getStore();
  if (!current) return repositoryRoot;
  let contextsStats;
  try {
    contextsStats = fs.lstatSync(contextsRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try { fs.mkdirSync(contextsRoot); } catch (createError) {
      if (createError.code !== "EEXIST") throw createError;
    }
    contextsStats = fs.lstatSync(contextsRoot);
  }
  if (contextsStats.isSymbolicLink() || !contextsStats.isDirectory() ||
      path.dirname(fs.realpathSync(contextsRoot)) !== fs.realpathSync(repositoryRoot)) {
    throw new Error("A raiz de contextos não é segura.");
  }
  assertSafeDescendant(current.dataRoot, contextsRoot);
  fs.mkdirSync(current.dataRoot, { recursive: true });
  assertSafeDescendant(current.dataRoot, contextsRoot);
  return current.dataRoot;
}

module.exports = {
  getCurrentContext,
  getCurrentDataRoot,
  runWithContext,
  resolveDataPath,
  ensureCurrentDataRoot,
  assertSafeDescendant
};
