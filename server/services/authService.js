const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function secureEquals(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getAuthConfig() {
  return {
    adminEmail: normalizeEmail(process.env.ADMIN_EMAIL),
    adminPassword: String(process.env.ADMIN_PASSWORD || ''),
    jwtSecret: String(process.env.AUTH_JWT_SECRET || ''),
    tokenTtl: String(process.env.AUTH_TOKEN_TTL || '7d').trim() || '7d'
  };
}

function isJwtAuthConfigured() {
  const cfg = getAuthConfig();
  return Boolean(cfg.adminEmail && cfg.adminPassword && cfg.jwtSecret);
}

function validateAdminCredentials(email, password) {
  const cfg = getAuthConfig();
  if (!cfg.adminEmail || !cfg.adminPassword) return false;
  return secureEquals(normalizeEmail(email), cfg.adminEmail) && secureEquals(password, cfg.adminPassword);
}

function createAccessToken(payload = {}) {
  const cfg = getAuthConfig();
  if (!cfg.jwtSecret) {
    throw new Error('AUTH_JWT_SECRET is required for token generation');
  }
  return jwt.sign(payload, cfg.jwtSecret, { expiresIn: cfg.tokenTtl });
}

function verifyAccessToken(token) {
  const cfg = getAuthConfig();
  if (!cfg.jwtSecret) {
    throw new Error('AUTH_JWT_SECRET is required for token verification');
  }
  return jwt.verify(token, cfg.jwtSecret);
}

module.exports = {
  normalizeEmail,
  getAuthConfig,
  isJwtAuthConfigured,
  validateAdminCredentials,
  createAccessToken,
  verifyAccessToken
};
