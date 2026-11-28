'use strict';

const crypto = require('node:crypto');

const SESSION_COOKIE = 'nexus_session';
const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map();

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseCookie(request, name) {
  const cookieHeader = String(request.headers.cookie || '');
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    return item.slice(separator + 1).trim();
  }
  return '';
}

function removeExpiredSessions(now = Date.now()) {
  for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
}

function issueContextSession({ userId, universeId, accessToken }, now = Date.now()) {
  removeExpiredSessions(now);
  if (sessions.size >= 100) return { success: false, status: 'session_capacity', message: 'Limite local de sessões atingido; encerre uma sessão ou reinicie a prévia.' };
  const rawSession = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now + SESSION_TTL_MS;
  sessions.set(digest(rawSession), { userId, universeId, accessToken, expiresAt });
  return {
    success: true,
    cookie: `${SESSION_COOKIE}=${rawSession}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    expiresAt
  };
}

function getContextSession(request, options = {}) {
  const rawSession = parseCookie(request, SESSION_COOKIE);
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(rawSession)) return { success: false, status: 'session_required' };
  const key = digest(rawSession);
  const session = sessions.get(key);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return { success: false, status: 'session_expired' };
  }
  if (options.matchHeaders !== false &&
      (request.headers['x-nexus-user'] !== session.userId || request.headers['x-nexus-universe'] !== session.universeId)) {
    return { success: false, status: 'session_context_mismatch' };
  }
  return { success: true, userId: session.userId, universeId: session.universeId, accessToken: session.accessToken, expiresAt: session.expiresAt };
}

function revokeContextSession(request) {
  const rawSession = parseCookie(request, SESSION_COOKIE);
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(rawSession)) return false;
  return sessions.delete(digest(rawSession));
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function configuredAdminToken() {
  const token = process.env.NEXUS_PREVIEW_ADMIN_TOKEN;
  if (typeof token !== 'string' || token.length < 43 || token.length > 256 || /[\s\x00-\x1f\x7f]/.test(token)) return null;
  return token;
}

function verifyAdminAuthorization(request) {
  const expected = configuredAdminToken();
  if (!expected) return { authorized: false, status: 'admin_auth_not_configured' };
  const authorization = String(request.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return { authorized: false, status: 'admin_credentials_required' };
  const supplied = authorization.slice(7);
  if (supplied.length > 256) return { authorized: false, status: 'admin_credentials_invalid' };
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  const suppliedDigest = crypto.createHash('sha256').update(supplied).digest();
  return crypto.timingSafeEqual(expectedDigest, suppliedDigest)
    ? { authorized: true }
    : { authorized: false, status: 'admin_credentials_invalid' };
}

module.exports = {
  SESSION_TTL_MS,
  issueContextSession,
  getContextSession,
  revokeContextSession,
  clearSessionCookie,
  verifyAdminAuthorization,
  configuredAdminToken
};
