const crypto = require('crypto');
const { isJwtAuthConfigured, verifyAccessToken } = require('../services/authService');

function isWriteAuthEnabled() {
  const explicitlyDisabled = String(process.env.DISABLE_WRITE_AUTH || '').trim().toLowerCase() === 'true';
  if (explicitlyDisabled) return false;

  const hasApiKey = String(process.env.SIGNAL_WRITE_API_KEY || '').trim().length > 0;
  return process.env.NODE_ENV === 'production' || hasApiKey || isJwtAuthConfigured();
}

function getProvidedToken(req) {
  const headerValue = String(req.headers['x-api-key'] || '').trim();
  if (headerValue) return headerValue;

  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
}

function secureEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireWriteAuth(req, res, next) {
  if (!isWriteAuthEnabled()) {
    return next();
  }

  const providedToken = getProvidedToken(req);
  if (!providedToken) {
    return res.status(401).json({
      message: 'Unauthorized write request.'
    });
  }

  if (isJwtAuthConfigured()) {
    try {
      const decoded = verifyAccessToken(providedToken);
      req.auth = {
        email: String(decoded?.sub || ''),
        role: String(decoded?.role || 'admin')
      };
      return next();
    } catch (error) {
      return res.status(401).json({
        message: 'Invalid or expired authentication token.'
      });
    }
  }

  const expectedToken = String(process.env.SIGNAL_WRITE_API_KEY || '').trim();
  if (!expectedToken) {
    console.error('[Auth] Configure JWT auth (ADMIN_EMAIL/ADMIN_PASSWORD/AUTH_JWT_SECRET) or set SIGNAL_WRITE_API_KEY.');
    return res.status(503).json({
      message: 'Write operations are temporarily unavailable.'
    });
  }

  if (!secureEquals(providedToken, expectedToken)) {
    return res.status(401).json({
      message: 'Unauthorized write request.'
    });
  }

  return next();
}

module.exports = { requireWriteAuth };
