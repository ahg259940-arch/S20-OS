const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const authSession = require("./auth-session.js");
const identityProvider = require("../core/identity-provider.js");
const systemProfile = require("../core/system-profile.js");

const webRoot = path.join(__dirname, "web");
const MAX_BODY_BYTES = 16 * 1024;
const failures = new Map();
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/backup-crypto.js", ["backup-crypto.js", "text/javascript; charset=utf-8"]],
  ["/layout-geometry.js", ["layout-geometry.js", "text/javascript; charset=utf-8"]],
  ["/presentation.js", ["presentation.js", "text/javascript; charset=utf-8"]],
  ["/app.css", ["app.css", "text/css; charset=utf-8"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
  ["/assets/nexus.svg", ["assets/nexus.svg", "image/svg+xml"]],
  ["/assets/nexus-192.png", ["assets/nexus-192.png", "image/png"]],
  ["/assets/nexus-512.png", ["assets/nexus-512.png", "image/png"]]
]);

function applySecurityHeaders(response, isApi = false) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (isApi) response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, status, value, headers = {}) {
  applySecurityHeaders(response, true);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(value));
}
function fail(response, status, code, message) {
  sendJson(response, status, { success: false, error: { code, message } });
}

function sameOriginRequest(request, requireOrigin = false) {
  const host = request.headers.host;
  if (host !== "127.0.0.1:4317" && host !== "localhost:4317" && host !== "[::1]:4317" &&
      host !== `127.0.0.1:${process.env.NEXUS_PREVIEW_PORT || "4317"}` &&
      host !== `localhost:${process.env.NEXUS_PREVIEW_PORT || "4317"}`) return false;
  const origin = request.headers.origin;
  if (!origin) return !requireOrigin;
  if (requireOrigin && request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "same-origin") return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.host === host;
  } catch (_error) { return false; }
}

function hasValidDeviceToken(request) {
  const expected = process.env.NEXUS_DEVICE_TOKEN;
  if (!expected) return true;
  const supplied = String(request.headers["x-nexus-device-token"] || "");
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(supplied) || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      const error = new Error("Content-Type application/json obrigatório.");
      error.status = 415;
      reject(error);
      return;
    }
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    request.on("data", chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        const error = new Error("Corpo da solicitação excede o limite.");
        error.status = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
        resolve(value);
      } catch (_error) {
        const error = new Error("JSON inválido.");
        error.status = 400;
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function validateString(value, maxLength, allowEmpty = false) {
  return typeof value === "string" && value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0) && !/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
}

function recordSecurityEvent(type, details) {
  try { require("../core/audit.js").recordEvent(type, details); return true; }
  catch (_error) { return false; }
}

function authenticationFailureCount(request, scope) {
  const now = Date.now();
  const key = `${scope}:${request.socket.remoteAddress || "local"}`;
  const entry = failures.get(key) || { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60_000; }
  entry.count++; failures.set(key, entry);
  return entry.count;
}

function requireAdmin(request, response, operation) {
  const result = authSession.verifyAdminAuthorization(request);
  if (!result.authorized) {
    const count = authenticationFailureCount(request, "admin");
    recordSecurityEvent("preview_admin_access_denied", { operation, status: result.status, attempt: count > 12 ? "rate_limited" : "denied" });
    const status = count > 12 ? 429 : result.status === "admin_auth_not_configured" ? 503 : 401;
    const message = status === 503 ? "A chave administrativa local não está configurada; a operação foi bloqueada." : status === 429 ? "Muitas tentativas; aguarde antes de tentar novamente." : "Autorização administrativa inválida.";
    fail(response, status, result.status, message);
    return false;
  }
  if (!recordSecurityEvent("preview_admin_access_granted", { operation })) {
    fail(response, 503, "audit_unavailable", "A operação administrativa foi bloqueada porque não pôde ser auditada.");
    return false;
  }
  return true;
}

function withContext(request, callback) {
  const session = authSession.getContextSession(request);
  if (!session.success) {
    const count = authenticationFailureCount(request, "context");
    recordSecurityEvent("preview_context_session_denied", { status: session.status, attempt: count > 12 ? "rate_limited" : "denied" });
    const error = new Error(count > 12 ? "Muitas tentativas; aguarde antes de tentar novamente." : "Sessão local ausente, expirada ou vinculada a outro contexto.");
    error.status = count > 12 ? 429 : session.status === "session_context_mismatch" ? 409 : 401;
    throw error;
  }
  return require("../core/context-manager.js").switchContext(session.userId, session.universeId, session.accessToken, callback);
}
function dashboardSnapshot() {
  const memory = require("../memory/memory.js").loadMemory();
  const intelligence = require("../core/intelligence.js");
  const goals = require("../core/goals.js").loadGoals();
  const tasks = require("../core/tasks.js").loadTasks();
  const preferences = require("../core/preferences.js").loadPreferences();
  const events = require("../core/audit.js").readEvents({ limit: 30 }).map(event => ({
    type: event.type,
    recordedAt: event.recordedAt,
    status: event.details?.status || null
  }));
  const system = systemProfile.getSystemProfile({ sessionActive: true });
  return {
    context: require("../core/context-manager.js").getCurrentContext(),
    identity: system.identity,
    system,
    memory: {
      experiences: memory.experiences.slice(-30).reverse(),
      knowledge: memory.knowledge.slice(-20).reverse(),
      relationships: memory.relationships.slice(-20).reverse(),
      total: memory.experiences.length + memory.knowledge.length + memory.relationships.length
    },
    memoryReview: require("../memory/memory.js").reviewKnowledge({ staleAfterDays: 365 }),
    conversations: intelligence.inspectConversation().slice(-30),
    goals,
    tasks,
    preferences,
    audit: events
  };
}

async function handleApi(request, response, url) {
  const pathname = url.pathname;
  const method = request.method;
  if (pathname === "/api/minecraft/agent/observations") {
    return fail(response, 503, "minecraft_agent_unavailable", "O gateway de agente Minecraft não está incluído nesta versão do N.E.X.U.S.");
  }
  if (method !== "GET" && !sameOriginRequest(request, true)) return fail(response, 403, "origin_denied", "Origem não permitida.");

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, {
      success: true,
      status: "online",
      provider: "not_invoked",
      identity: identityProvider.getIdentity().name,
      preview: "loopback_only"
    });
  }

  // Minecraft connection management is local and independent of a N.E.X.U.S. account.
  if (pathname.startsWith("/api/minecraft/")) {
    const minecraft = require("../minecraft/manager.js");
    try {
      if (method === "GET" && pathname === "/api/minecraft/connections") return sendJson(response, 200, { success: true, ...minecraft.list() });
      if (method === "POST" && pathname === "/api/minecraft/connections") return sendJson(response, 200, { success: true, ...minecraft.upsert(await readJsonBody(request)) });
      if (method === "POST" && pathname === "/api/minecraft/test") return sendJson(response, 200, { success: true, ...(await minecraft.test(await readJsonBody(request))) });
      if (method === "PUT" && pathname === "/api/minecraft/access") return sendJson(response, 200, { success: true, ...minecraft.updateAccess(await readJsonBody(request)) });
      return fail(response, 404, "minecraft_route_not_found", "Rota Minecraft não encontrada.");
    } catch (error) { return fail(response, 400, "minecraft_request_failed", error.message || "Operação Minecraft não concluída."); }
  }

  const contexts = require("../core/context-manager.js");
  if (method === "POST" && pathname === "/api/universes") {
    if (!requireAdmin(request, response, "create_universe")) return;
    try {
      const body = await readJsonBody(request);
      if (!validateString(body.id, 48) || !validateString(body.name, 100)) return fail(response, 400, "invalid_input", "ID e nome do universo são obrigatórios.");
      const result = contexts.createUniverse({ id: body.id, name: body.name });
      return sendJson(response, result.success ? 201 : 400, result);
    } catch (error) { return fail(response, error.status || 400, "invalid_request", error.status ? error.message : "Solicitação inválida."); }
  }

  if (method === "POST" && pathname === "/api/users") {
    if (!requireAdmin(request, response, "create_user")) return;
    try {
      const body = await readJsonBody(request);
      if (!validateString(body.id, 48) || !validateString(body.displayName, 100) || !validateString(body.universeId, 48)) return fail(response, 400, "invalid_input", "ID, nome e universo são obrigatórios.");
      const result = contexts.createUser({ id: body.id, displayName: body.displayName, universeId: body.universeId });
      return sendJson(response, result.success ? 201 : 400, result);
    } catch (error) { return fail(response, error.status || 400, "invalid_request", error.status ? error.message : "Solicitação inválida."); }
  }

  if (method === "POST" && pathname === "/api/context/activate") {
    try {
      const body = await readJsonBody(request);
      const authorization = String(request.headers.authorization || "");
      const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      const activation = contexts.switchContext(body.userId, body.universeId, accessToken, () => {
        const current = contexts.getCurrentContext();
        const safeContext = { userId: current.userId, displayName: current.displayName, universeId: current.universeId, universeName: current.universeName, game: current.game };
        return require("../core/audit.js").executeAudited("preview_context_authenticated", { userId: current.userId, universeId: current.universeId }, () => ({
          context: safeContext, preferences: require("../core/preferences.js").loadPreferences()
        }));
      });
      if (activation?.success === false) return fail(response, 503, activation.status || "audit_unavailable", "A sessão não foi criada porque a autenticação ou auditoria falhou.");
      const issued = authSession.issueContextSession({ userId: body.userId, universeId: body.universeId, accessToken });
      if (!issued.success) return fail(response, 503, issued.status, issued.message);
      return sendJson(response, 200, { success: true, context: activation.context, preferences: activation.preferences, expiresAt: issued.expiresAt }, { "Set-Cookie": issued.cookie });
    } catch (_error) {
      const count = authenticationFailureCount(request, "context");
      recordSecurityEvent("preview_context_authentication_denied", { attempt: count > 12 ? "rate_limited" : "denied" });
      return fail(response, count > 12 ? 429 : 401, count > 12 ? "rate_limited" : "context_denied", count > 12 ? "Muitas tentativas; aguarde antes de tentar novamente." : "Usuário, universo ou credencial inválidos.");
    }
  }

  if (method === "POST" && pathname === "/api/context/logout") {
    const session = authSession.getContextSession(request, { matchHeaders: false });
    let auditRecorded = false;
    if (session.success) {
      try { auditRecorded = contexts.switchContext(session.userId, session.universeId, session.accessToken, () => recordSecurityEvent("preview_context_session_revoked", { userId: session.userId, universeId: session.universeId })); }
      catch (_error) { auditRecorded = false; }
    }
    authSession.revokeContextSession(request);
    return sendJson(response, auditRecorded || !session.success ? 200 : 207, { success: true, revoked: true, auditRecorded }, { "Set-Cookie": authSession.clearSessionCookie() });
  }
  try {
    return await withContext(request, async () => {
      if (method === "GET" && pathname === "/api/session") return sendJson(response, 200, { success: true, context: contexts.getCurrentContext(), expiresAt: authSession.getContextSession(request).expiresAt });
      if (method === "POST" && pathname === "/api/context/switch") {
        const body = await readJsonBody(request);
        if (!validateString(body.universeId, 48)) return fail(response, 400, "invalid_context", "Informe um universo válido.");
        const activeSession = authSession.getContextSession(request);
        const current = contexts.getCurrentContext();
        if (body.universeId === current.universeId) return sendJson(response, 200, { success: true, context: { userId: current.userId, displayName: current.displayName, universeId: current.universeId, universeName: current.universeName, game: current.game } });
        let switched;
        try {
          switched = contexts.switchContext(activeSession.userId, body.universeId, activeSession.accessToken, () => {
            const target = contexts.getCurrentContext();
            const safeContext = { userId: target.userId, displayName: target.displayName, universeId: target.universeId, universeName: target.universeName, game: target.game };
            return require("../core/audit.js").executeAudited("preview_context_switched", {
              userId: target.userId, fromUniverseId: activeSession.universeId, toUniverseId: target.universeId
            }, () => ({ success: true, context: safeContext }));
          });
        } catch (_error) {
          return fail(response, 403, "context_switch_denied", "O usuário não está autorizado a acessar esse universo.");
        }
        if (!switched?.success || !switched.context) return fail(response, 503, switched?.status || "context_switch_failed", "A troca foi bloqueada ou não pôde ser auditada.");
        const issued = authSession.issueContextSession({ userId: switched.context.userId, universeId: switched.context.universeId, accessToken: activeSession.accessToken });
        if (!issued.success) return fail(response, 503, issued.status, issued.message);
        authSession.revokeContextSession(request);
        return sendJson(response, 200, { success: true, context: switched.context, expiresAt: issued.expiresAt }, { "Set-Cookie": issued.cookie });
      }
      if (method === "GET" && pathname === "/api/universes") {
        const current = contexts.getCurrentContext(); const user = contexts.getUser(current.userId); const allowed = new Set(user?.universeIds || []);
        return sendJson(response, 200, { success: true, universes: contexts.listUniverses().filter(universe => allowed.has(universe.id)) });
      }
      if (method === "GET" && pathname === "/api/profile") return sendJson(response, 200, { success: true, profile: dashboardSnapshot() });

      if (pathname === "/api/ai/session") {
        const intelligence = require("../core/intelligence.js");
        if (method === "GET") return sendJson(response, 200, { success: true, ai: intelligence.getProviderStatus() });
        if (method === "PUT") {
          const body = await readJsonBody(request);
          if (typeof body.provider !== "string" || !["openai", "gemini"].includes(body.provider)) return fail(response, 400, "invalid_ai_provider", "Escolha OpenAI ou Gemini.");
          if (typeof body.apiKey !== "string" || body.apiKey.length > 300) return fail(response, 400, "invalid_ai_key", "A chave de API está inválida.");
          const result = require("../core/audit.js").executeAudited("ai_session_configured", { provider: body.provider }, () => ({ success: true, ai: intelligence.setSessionProvider(body.provider, body.apiKey) }));
          return sendJson(response, result.success ? 200 : 503, result);
        }
        if (method === "DELETE") {
          const result = require("../core/audit.js").executeAudited("ai_session_cleared", {}, () => ({ success: true, ai: intelligence.clearSessionProvider() }));
          return sendJson(response, result.success ? 200 : 503, result);
        }
        return fail(response, 405, "method_not_allowed", "Método não permitido.");
      }

      if (method === "GET" && pathname === "/api/memory/review") {
        const rawDays = url.searchParams.get("staleAfterDays");
        const staleAfterDays = rawDays === null ? 365 : Number(rawDays);
        if (!Number.isInteger(staleAfterDays) || staleAfterDays < 30 || staleAfterDays > 3650) {
          return fail(response, 400, "invalid_review_period", "O período de revisão deve estar entre 30 e 3650 dias.");
        }
        const review = require("../memory/memory.js").reviewKnowledge({ staleAfterDays });
        return sendJson(response, 200, { success: true, staleAfterDays, review });
      }

      if (method === "GET" && pathname === "/api/export") {
        const profile = dashboardSnapshot();
        const payload = {
          format: "nexus-context-export-v1",
          exportedAt: new Date().toISOString(),
          context: profile.context,
          data: {
            memory: require("../memory/memory.js").loadMemory(),
            conversations: require("../core/intelligence.js").inspectConversation(),
            goals: require("../core/goals.js").loadGoals(),
            tasks: require("../core/tasks.js").loadTasks(),
            preferences: profile.preferences
          }
        };
        const digest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        return sendJson(response, 200, { success: true, digest, backup: payload });
      }

      if (method === "POST" && pathname === "/api/memory") {
        const body = await readJsonBody(request);
        if (!validateString(body.description, 3000)) return fail(response, 400, "invalid_memory", "A lembrança deve conter de 1 a 3000 caracteres.");
        const result = require("../memory/memory.js").rememberExperience(body.description.trim());
        if (result?.success === false) return fail(response, 503, result.status || "memory_failed", "Não foi possível confirmar a gravação da memória.");
        return sendJson(response, 201, { success: true, result });
      }

      if (method === "POST" && pathname === "/api/chat") {
        const body = await readJsonBody(request);
        if (!validateString(body.message, 4000)) return fail(response, 400, "invalid_message", "A mensagem deve conter de 1 a 4000 caracteres.");
        const result = await require("../core/engine.js").processSituation(body.message.trim(), identityProvider.getIdentity().name + " · PWA local", { generative: body.generative === true, persistGenerative: false });
        if (result.success === false) return fail(response, 503, result.status || "processing_failed", result.message || "O núcleo não concluiu o processamento.");
        const answer = result.reasoning?.generative?.status === "available"
          ? result.reasoning.generative.answer
          : [result.decision.decision, result.decision.justification].filter(Boolean).join("\n\n");
        const persistence = require("../core/intelligence.js").persistInteraction(body.message.trim(), answer || "A situação foi analisada localmente.");
        return sendJson(response, persistence.success && persistence.memorySaved
          ? 200 : 207, { success: true, result, persistence: { historySaved: persistence.historySaved, memorySaved: persistence.memorySaved } });
      }

      const projects = require("../core/projects.js");
      if (method === "GET" && pathname === "/api/projects") {
        const status = url.searchParams.get("status") || undefined;
        const result = projects.listProjects({ status });
        return sendJson(response, result.success ? 200 : 400, result);
      }
      const projectMatch = pathname.match(/^\/api\/projects\/([a-f0-9-]{36})$/);
      if (method === "GET" && projectMatch) {
        const project = projects.getProject(projectMatch[1]);
        return project ? sendJson(response, 200, { success: true, project }) : fail(response, 404, "project_not_found", "Projeto não encontrado neste contexto.");
      }
      if (method === "POST" && pathname === "/api/projects") {
        const body = await readJsonBody(request);
        const result = projects.createProject({ name: body.name, description: body.description, kind: body.kind || "general" });
        return sendJson(response, result.success ? 201 : result.status === "audit_completion_unrecorded" ? 503 : 400, result);
      }
      if (method === "PATCH" && projectMatch) {
        const body = await readJsonBody(request);
        const result = projects.updateProject(projectMatch[1], { name: body.name, description: body.description, kind: body.kind });
        return sendJson(response, result.success ? 200 : result.status === "audit_completion_unrecorded" ? 503 : 400, result);
      }
      const projectAction = pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/(archive|restore)$/);
      if (method === "POST" && projectAction) {
        const result = projectAction[2] === "archive" ? projects.archiveProject(projectAction[1]) : projects.restoreProject(projectAction[1]);
        return sendJson(response, result.success ? 200 : result.status === "audit_completion_unrecorded" ? 503 : 400, result);
      }
      if (method === "DELETE" && projectMatch) {
        const body = await readJsonBody(request);
        const result = projects.deleteProject(projectMatch[1], body.confirmation);
        return sendJson(response, result.success ? 200 : result.status === "audit_completion_unrecorded" ? 503 : 400, result);
      }

      if (method === "POST" && pathname === "/api/projects/propose") {
        const body = await readJsonBody(request);
        if (!validateString(body.name, 100) || !validateString(body.description, 2000) ||
            (body.kind !== undefined && !validateString(body.kind, 40))) return fail(response, 400, "invalid_project_proposal", "Nome, descrição e tipo válidos são obrigatórios.");
        const proposal = require("../core/development.js").proposeProject({ name: body.name.trim(), description: body.description.trim(), kind: String(body.kind || "tool").trim() });
        return sendJson(response, proposal.success ? 201 : 503, proposal);
      }

      if (method === "POST" && pathname === "/api/goals") {
        const body = await readJsonBody(request);
        if (!validateString(body.title, 160) || !validateString(body.description, 2000) || !validateString(body.reason, 1000, true)) return fail(response, 400, "invalid_goal", "Título e descrição válidos são obrigatórios.");
        const result = require("../core/goals.js").createGoal(body.title.trim(), body.description.trim(), String(body.reason || "").trim());
        return sendJson(response, result?.success === false ? 400 : 201, { success: result?.success !== false, goal: result });
      }

      const planMatch = pathname.match(/^\/api\/goals\/([a-zA-Z0-9_-]{1,80})\/plan$/);
      if (method === "POST" && planMatch) {
        const result = require("../core/tasks.js").planGoal(planMatch[1]);
        return sendJson(response, result.success ? 200 : 400, result);
      }

      const goalMatch = pathname.match(/^\/api\/goals\/([a-zA-Z0-9_-]{1,80})$/);
      if ((method === "PATCH" || method === "POST") && goalMatch) {
        const body = await readJsonBody(request);
        const result = require("../core/goals.js").updateGoal(goalMatch[1], body.progress, body.observation || "Atualizado pelo aplicativo.");
        return sendJson(response, result.success ? 200 : 400, result);
      }

      if (method === "POST" && pathname === "/api/tasks") {
        const body = await readJsonBody(request);
        if (!validateString(body.goalId, 80) || !validateString(body.title, 160) || !validateString(body.description, 2000)) return fail(response, 400, "invalid_task", "Objetivo, título e descrição válidos são obrigatórios.");
        const result = require("../core/tasks.js").createTask(body.goalId, body.title.trim(), body.description.trim());
        const success = result?.success !== false && Boolean(result?.id);
        return sendJson(response, success ? 201 : 400, { success, task: result });
      }

      const taskAction = pathname.match(/^\/api\/tasks\/([a-zA-Z0-9_-]{1,80})\/(start|progress|complete|cancel)$/);
      if (method === "POST" && taskAction) {
        const body = await readJsonBody(request);
        const [, taskId, action] = taskAction;
        const tasks = require("../core/tasks.js");
        const result = action === "start" ? tasks.startTask(taskId)
          : action === "progress" ? tasks.updateTaskProgress(taskId, body.progress, body.observation)
            : action === "complete" ? tasks.completeTask(taskId, body.evidence)
              : tasks.cancelTask(taskId, body.reason || "Cancelada pelo usuário.");
        const success = result?.success !== false && Boolean(result?.task || result?.id);
        return sendJson(response, success ? 200 : 400, { success, result });
      }

      if (method === "GET" && pathname === "/api/preferences") return sendJson(response, 200, { success: true, preferences: require("../core/preferences.js").loadPreferences() });
      if (method === "PUT" && pathname === "/api/preferences") {
        const body = await readJsonBody(request);
        const result = require("../core/preferences.js").savePreferences(body);
        return sendJson(response, result.success ? 200 : 400, result);
      }
      if (method === "POST" && pathname === "/api/preferences/reset") {
        const result = require("../core/preferences.js").resetPreferences();
        return sendJson(response, result.success ? 200 : 400, result);
      }
      return fail(response, 404, "not_found", "Rota não encontrada.");
    });
  } catch (error) {
    return fail(response, error.status || 500, error.status === 429 ? "rate_limited" : "request_failed",
      error.status ? error.message : "A solicitação falhou; consulte a auditoria local.");
  }
}

function serveStatic(response, pathname) {
  const descriptor = staticFiles.get(pathname);
  if (!descriptor) return fail(response, 404, "not_found", "Arquivo não encontrado.");
  const filePath = path.join(webRoot, descriptor[0]);
  try {
    const content = fs.readFileSync(filePath);
    applySecurityHeaders(response);
    response.setHeader("Cache-Control", pathname === "/sw.js" ? "no-cache" : "no-store");
    response.writeHead(200, { "Content-Type": descriptor[1] });
    response.end(content);
  } catch (_error) {
    fail(response, 503, "asset_unavailable", "Ativo da interface indisponível.");
  }
}

function createServer() {
  const server = http.createServer((request, response) => {
    let url;
    try { url = new URL(request.url, "http://127.0.0.1"); }
    catch (_error) { return fail(response, 400, "invalid_url", "URL inválida."); }
    const isBedrockAgent = url.pathname === "/api/minecraft/agent/observations";
    if (!isBedrockAgent && !sameOriginRequest(request, request.method !== "GET" && request.method !== "HEAD")) return fail(response, 403, "host_denied", "O preview aceita somente conexões locais e mesma origem.");
    if (url.pathname.startsWith("/api/")) {
      if (!isBedrockAgent && !hasValidDeviceToken(request)) return fail(response, 401, "device_token_required", "Token local do aplicativo Android inválido ou ausente.");
      handleApi(request, response, url).catch(() => {
        if (!response.headersSent) fail(response, 500, "request_failed", "A solicitação falhou; consulte a auditoria local.");
        else response.destroy();
      });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") return fail(response, 405, "method_denied", "Método não permitido.");
    return serveStatic(response, url.pathname);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

function start() {
  const port = Number(process.env.NEXUS_PREVIEW_PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("NEXUS_PREVIEW_PORT precisa estar entre 1024 e 65535.");
  const server = createServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`Prévia N.E.X.U.S. disponível em http://127.0.0.1:${port}/ (somente loopback).\n`);
  });
  server.on("error", () => {
    process.stderr.write("Não foi possível iniciar a prévia local. Verifique se a porta está livre.\n");
    process.exitCode = 1;
  });
  return server;
}

if (require.main === module) start();

module.exports = { createServer, start };
