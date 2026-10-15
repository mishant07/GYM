const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_twenty_gym_sessions_987654321';

class AppError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['x-auth-token']) {
    token = req.headers['x-auth-token'];
  }

  if (!token) {
    return next(new AppError(401, 'unauthenticated', 'Log in again.'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return next(new AppError(401, 'unauthenticated', 'Invalid or expired session token. Log in again.'));
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return next(new AppError(403, 'forbidden', 'Admins only.'));
  }
  next();
}

/**
 * Global centralized error handler.
 * Consistent error schema, correct status codes, never leaks stack traces.
 */
function errorHandler(err, req, res, next) {
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  const code = err.code || (status === 500 ? 'internal_server_error' : 'error');
  const message = err.message || 'An unexpected error occurred.';
  const details = err.details || {};

  if (status === 500) {
    console.error('Unhandled internal server error:', err);
  }

  res.status(status).json({
    code,
    message,
    details,
    error: {
      code,
      message,
      details
    }
  });
}

module.exports = {
  AppError,
  generateToken,
  authenticateToken,
  requireAdmin,
  errorHandler
};
