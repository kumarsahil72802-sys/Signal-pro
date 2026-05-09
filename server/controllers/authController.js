const {
  getAuthConfig,
  isJwtAuthConfigured,
  normalizeEmail,
  validateAdminCredentials,
  createAccessToken,
  verifyAccessToken
} = require('../services/authService');

function extractBearerToken(req) {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
}

async function login(req, res) {
  try {
    if (!isJwtAuthConfigured()) {
      return res.status(503).json({
        message: 'Login is not configured on this server.'
      });
    }

    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    if (!validateAdminCredentials(email, password)) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = createAccessToken({
      sub: email,
      role: 'admin'
    });
    const cfg = getAuthConfig();

    return res.json({
      token,
      tokenType: 'Bearer',
      expiresIn: cfg.tokenTtl,
      user: {
        email,
        role: 'admin'
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed.', error: error.message });
  }
}

async function me(req, res) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Missing authorization token.' });
    }

    const decoded = verifyAccessToken(token);
    return res.json({
      authenticated: true,
      user: {
        email: normalizeEmail(decoded?.sub),
        role: decoded?.role || 'admin'
      }
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}

module.exports = {
  login,
  me
};
