const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const storage = require("./storage.js");
const contextScope = require("./context-scope.js");

const repositoryRoot = path.resolve(__dirname, "..");
const contextsRoot = path.join(repositoryRoot, "contexts");
const registryPath = path.join(contextsRoot, "registry.json");
const emptyRegistry = { version: 1, users: [], universes: [] };
const idPattern = /^[a-z0-9](?:[a-z0-9_-]{0,46}[a-z0-9])?$/;
const nameLimit = 100;

function validId(value) {
  return typeof value === "string" && value.length <= 48 && idPattern.test(value);
}

function validName(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.trim().length <= nameLimit && !/[\0-\x1f\x7f]/.test(value);
}

function assertRealDirectory(directory, expectedParent) {
  const stats = fs.lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("O caminho de contextos contém um link simbólico ou não é diretório.");
  }
  const realDirectory = fs.realpathSync(directory);
  const realParent = fs.realpathSync(expectedParent);
  if (path.dirname(realDirectory) !== realParent) {
    throw new Error("O diretório de contextos saiu da raiz autorizada.");
  }
  return realDirectory;
}

function ensureContextsRoot(create = false) {
  const realRepository = fs.realpathSync(repositoryRoot);
  let stats;
  try {
    stats = fs.lstatSync(contextsRoot);
  } catch (error) {
    if (error.code !== "ENOENT" || !create) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    try { fs.mkdirSync(contextsRoot); } catch (createError) {
      if (createError.code !== "EEXIST") throw createError;
    }
    stats = fs.lstatSync(contextsRoot);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("A raiz de contextos contém um link simbólico ou não é diretório.");
  }
  const realContexts = fs.realpathSync(contextsRoot);
  if (path.dirname(realContexts) !== realRepository) {
    throw new Error("A raiz real de contextos saiu do projeto autorizado.");
  }
  return realContexts;
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

function normalizeRegistry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.version !== 1 || !Array.isArray(value.users) || !Array.isArray(value.universes)) {
    throw new Error("O registro de contextos está inválido; os dados foram preservados.");
  }
  const userIds = new Set();
  for (const user of value.users) {
    if (!user || !validId(user.id) || !validName(user.displayName) ||
        !Array.isArray(user.universeIds) || !validId(user.primaryUniverseId) ||
        typeof user.credentialHash !== "string" || !/^[a-f0-9]{64}$/.test(user.credentialHash) ||
        !user.universeIds.includes(user.primaryUniverseId) || userIds.has(user.id)) {
      throw new Error("O registro de usuários está inválido; os dados foram preservados.");
    }
    userIds.add(user.id);
    if (user.universeIds.some(id => !validId(id))) {
      throw new Error("O registro contém associação de universo inválida.");
    }
  }
  const universeIds = new Set();
  for (const universe of value.universes) {
    if (!universe || !validId(universe.id) || !validName(universe.name) ||
        universe.game !== "minecraft" || universeIds.has(universe.id)) {
      throw new Error("O registro de universos está inválido; os dados foram preservados.");
    }
    universeIds.add(universe.id);
  }
  if (value.users.some(user => user.universeIds.some(id => !universeIds.has(id)))) {
    throw new Error("O registro contém usuário associado a universo inexistente.");
  }
  return value;
}

function loadRegistry() {
  const root = ensureContextsRoot(false);
  if (!root) return structuredClone(emptyRegistry);
  assertSafeDescendant(registryPath, root);
  return normalizeRegistry(storage.readJson(registryPath, emptyRegistry));
}

function audited(type, details, callback) {
  return require("./audit.js").executeAudited(type, details, callback);
}

function createUniverse(input = {}) {
  const { id, name } = input;
  if (!validId(id) || !validName(name)) {
    return { success: false, status: "invalid_universe", message: "Informe um ID simples e um nome válido para o universo." };
  }
  return audited("context_universe_created", { universeId: id }, () => {
    const root = ensureContextsRoot(true);
    assertSafeDescendant(registryPath, root);
    const now = new Date().toISOString();
    return storage.updateJson(registryPath, emptyRegistry, raw => {
      const registry = normalizeRegistry(raw);
      if (registry.universes.some(item => item.id === id)) {
        return { commit: false, result: { success: false, status: "universe_already_exists" } };
      }
      const universe = { id, name: name.trim(), game: "minecraft", createdAt: now };
      registry.universes.push(universe);
      return { result: { success: true, universe } };
    });
  });
}

function publicUser(user) {
  const { credentialHash: _credentialHash, ...safeUser } = user;
  return { ...safeUser, universeIds: [...user.universeIds] };
}

function credentialDigest(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function verifyCredential(user, token) {
  if (typeof token !== "string" || token.length < 40 || token.length > 100) return false;
  const presented = Buffer.from(credentialDigest(token), "hex");
  const stored = Buffer.from(user.credentialHash, "hex");
  return presented.length === stored.length && crypto.timingSafeEqual(presented, stored);
}

function createUser(input = {}) {
  const { id, displayName, universeId } = input;
  if (!validId(id) || !validName(displayName) || !validId(universeId)) {
    return { success: false, status: "invalid_user", message: "Informe ID, nome e universo válidos." };
  }
  return audited("context_user_created", { userId: id, universeId }, () => {
    const root = ensureContextsRoot(true);
    assertSafeDescendant(registryPath, root);
    const now = new Date().toISOString();
    return storage.updateJson(registryPath, emptyRegistry, raw => {
      const registry = normalizeRegistry(raw);
      if (registry.users.some(item => item.id === id)) {
        return { commit: false, result: { success: false, status: "user_already_exists" } };
      }
      if (!registry.universes.some(item => item.id === universeId)) {
        return { commit: false, result: { success: false, status: "universe_not_found" } };
      }
      const accessToken = crypto.randomBytes(32).toString("base64url");
      const user = {
        id,
        displayName: displayName.trim(),
        universeIds: [universeId],
        primaryUniverseId: universeId,
        credentialHash: credentialDigest(accessToken),
        createdAt: now
      };
      registry.users.push(user);
      return { result: { success: true, user: publicUser(user), accessToken } };
    });
  });
}

function associateUniverse(userId, universeId) {
  if (!validId(userId) || !validId(universeId)) {
    return { success: false, status: "invalid_association" };
  }
  return audited("context_universe_associated", { userId, universeId }, () => {
    const root = ensureContextsRoot(false);
    if (!root) return { success: false, status: "user_or_universe_not_found" };
    assertSafeDescendant(registryPath, root);
    return storage.updateJson(registryPath, emptyRegistry, raw => {
      const registry = normalizeRegistry(raw);
      const user = registry.users.find(item => item.id === userId);
      if (!user || !registry.universes.some(item => item.id === universeId)) {
        return { commit: false, result: { success: false, status: "user_or_universe_not_found" } };
      }
      if (!user.universeIds.includes(universeId)) user.universeIds.push(universeId);
      return { result: { success: true, user: publicUser(user) } };
    });
  });
}

function listUsers() {
  return loadRegistry().users.map(publicUser);
}

function listUniverses() {
  return loadRegistry().universes.map(universe => ({ ...universe }));
}

function getUser(userId) {
  if (!validId(userId)) return null;
  const user = loadRegistry().users.find(item => item.id === userId);
  return user ? publicUser(user) : null;
}

function contextFor(userId, universeId, accessToken) {
  const registry = loadRegistry();
  const user = registry.users.find(item => item.id === userId);
  if (!user || !verifyCredential(user, accessToken)) {
    throw new Error("Usuário ou credencial de contexto inválidos.");
  }
  const selectedUniverseId = universeId || user.primaryUniverseId;
  if (!user.universeIds.includes(selectedUniverseId)) {
    throw new Error("O usuário não está associado ao universo solicitado.");
  }
  const universe = registry.universes.find(item => item.id === selectedUniverseId);
  if (!universe) throw new Error("Universo associado não encontrado.");
  const root = ensureContextsRoot(false);
  if (!root) throw new Error("A raiz de contextos não está disponível.");
  const dataRoot = path.join(root, "users", user.id, "universes", universe.id);
  assertSafeDescendant(dataRoot, root);
  return {
    userId: user.id,
    displayName: user.displayName,
    universeId: universe.id,
    universeName: universe.name,
    game: universe.game,
    dataRoot
  };
}

function runInUniverse(userId, universeId, accessToken, callback) {
  if (typeof callback !== "function") throw new TypeError("A troca de contexto exige uma função.");
  const context = contextFor(userId, universeId, accessToken);
  return contextScope.runWithContext(context, callback);
}

function selectUser(userId, accessToken, callback) {
  if (typeof callback !== "function") throw new TypeError("A seleção de usuário exige uma função.");
  return runInUniverse(userId, null, accessToken, callback);
}

function switchContext(userId, universeId, accessToken, callback) {
  return runInUniverse(userId, universeId, accessToken, callback);
}

function getCurrentContext() {
  const current = contextScope.getCurrentContext();
  if (!current) return null;
  const { dataRoot: _privateRoot, ...publicContext } = current;
  return { ...publicContext };
}

function getCurrentDataRoot() {
  return contextScope.getCurrentDataRoot();
}

function ensureCurrentDataRoot() {
  return contextScope.ensureCurrentDataRoot();
}

function resolveDataPath(area, legacyPath) {
  return contextScope.resolveDataPath(area, legacyPath);
}

module.exports = {
  createUniverse,
  createUser,
  associateUniverse,
  listUsers,
  listUniverses,
  getUser,
  selectUser,
  runInUniverse,
  switchContext,
  getCurrentContext,
  resolveDataPath,
  getCurrentDataRoot,
  ensureCurrentDataRoot
};
