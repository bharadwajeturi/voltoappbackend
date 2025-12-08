/**
 * Async Error Handler Middleware
 * Wraps async route handlers to catch unhandled promise rejections
 * Prevents crashes and ensures consistent error response format
 */

const { logger } = require('./logger');
const { formatErrorResponse } = require('../utils/errorHandler');

/**
 * Wrap async route handler
 * @param {Function} fn - Async route handler
 * @returns {Function} - Wrapped handler with error catching
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    // Execute the async function
    Promise.resolve(fn(req, res, next))
      .catch((error) => {
        // Log the error
        logger.error({
          event: 'unhandled_error',
          method: req.method,
          path: req.path,
          message: error.message,
          stack: error.stack,
          statusCode: error.statusCode || 500,
        });

        // Format and send error response
        const errorResponse = formatErrorResponse(error);
        const statusCode = error.statusCode || 500;

        res.status(statusCode).json(errorResponse);
      });
  };
}

/**
 * Global error handler middleware
 * Should be registered last in Express app
 */
function globalErrorHandler(err, req, res, next) {
  logger.error({
    event: 'global_error_handler',
    message: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
  });

  const errorResponse = formatErrorResponse(err);
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json(errorResponse);
}

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res) {
  logger.warn({
    event: 'not_found',
    method: req.method,
    path: req.path,
  });

  res.status(404).json({
    status: 'error',
    statusCode: 404,
    message: 'Route not found',
    path: req.path,
  });
}

module.exports = {
  asyncHandler,
  globalErrorHandler,
  notFoundHandler,
};
