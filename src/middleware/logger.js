/**
 * Structured Logging Middleware
 * Logs all API requests, responses, errors
 * Uses Bunyan for production-ready logging
 */

const bunyan = require('bunyan');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Create logger instance
const logger = bunyan.createLogger({
  name: 'voltpath-backend',
  level: process.env.LOG_LEVEL || 'info',
  streams: [
    {
      // Console output for development
      stream: process.stdout,
      level: 'info',
    },
    {
      // File output for all logs
      path: path.join(logsDir, 'voltpath.log'),
      level: 'debug',
    },
    {
      // Separate file for errors
      path: path.join(logsDir, 'error.log'),
      level: 'error',
    },
  ],
  serializers: {
    req: bunyan.stdSerializers.req,
    res: bunyan.stdSerializers.res,
    err: bunyan.stdSerializers.err,
  },
});

/**
 * Express middleware for request logging
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Log incoming request
  logger.info({
    event: 'request_received',
    method: req.method,
    path: req.path,
    query: req.query,
    body: sanitizeBody(req.body),
    ip: req.ip,
  });

  // Override res.json to capture response
  const originalJson = res.json;
  res.json = function (data) {
    const duration = Date.now() - startTime;

    // Log response
    logger.info({
      event: 'request_completed',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration_ms: duration,
      response_size: JSON.stringify(data).length,
    });

    return originalJson.call(this, data);
  };

  next();
}

/**
 * Log API calls to external services
 */
function logApiCall(source, params, result, durationMs, status = 'success') {
  logger.info({
    event: 'api_call',
    source,
    params: sanitizeBody(params),
    resultCount: result?.length || 0,
    duration_ms: durationMs,
    status,
  });
}

/**
 * Log database operations
 */
function logDatabaseOperation(operation, query, duration, rowCount) {
  logger.debug({
    event: 'database_operation',
    operation,
    query: query.substring(0, 200), // Log first 200 chars
    duration_ms: duration,
    rowCount,
  });
}

/**
 * Log errors
 */
function logError(error, context = {}) {
  logger.error({
    event: 'error',
    message: error.message,
    stack: error.stack,
    statusCode: error.statusCode || 500,
    ...context,
  });
}

/**
 * Log application events
 */
function logEvent(eventName, details = {}) {
  logger.info({
    event: eventName,
    ...details,
  });
}

/**
 * Sanitize sensitive data from logs
 */
function sanitizeBody(body) {
  if (!body) return null;

  const sanitized = { ...body };

  // Remove sensitive fields
  const sensitiveFields = ['password', 'apiKey', 'token', 'secret', 'key'];
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '***REDACTED***';
    }
  }

  return sanitized;
}

module.exports = {
  logger,
  requestLogger,
  logApiCall,
  logDatabaseOperation,
  logError,
  logEvent,
};
