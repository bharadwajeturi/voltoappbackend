/**
 * Centralized Error Handling
 * Provides consistent error responses across the API
 */

class ApiError extends Error {
  constructor(message, statusCode = 500, data = {}) {
    super(message);
    this.statusCode = statusCode;
    this.data = data;
    this.timestamp = new Date().toISOString();
  }
}

/**
 * Format error response
 * @param {Error} error - Error object
 * @returns {Object} - Formatted error response
 */
function formatErrorResponse(error) {
  if (error instanceof ApiError) {
    return {
      status: 'error',
      statusCode: error.statusCode,
      message: error.message,
      timestamp: error.timestamp,
      data: error.data,
    };
  }

  return {
    status: 'error',
    statusCode: 500,
    message: error.message || 'Internal Server Error',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Validate required fields
 * @param {Object} obj - Object to validate
 * @param {Array} requiredFields - Fields that must be present
 * @throws {ApiError} - If required fields are missing
 */
function validateRequired(obj, requiredFields) {
  for (const field of requiredFields) {
    if (!obj.hasOwnProperty(field) || obj[field] === null || obj[field] === undefined) {
      throw new ApiError(`Missing required field: ${field}`, 400, { field });
    }
  }
}

/**
 * Validate battery parameters
 * @param {number} startSOC - Starting battery %
 * @param {number} targetArrivalSOC - Target arrival battery %
 * @param {number} maxChargeSOC - Max charging %
 * @throws {ApiError} - If parameters are invalid
 */
function validateBatteryParams(startSOC, targetArrivalSOC, maxChargeSOC = 80) {
  if (startSOC <= targetArrivalSOC) {
    throw new ApiError(
      'Invalid battery config: Start SOC must be greater than target arrival SOC',
      400,
      { startSOC, targetArrivalSOC }
    );
  }

  if (targetArrivalSOC > maxChargeSOC) {
    throw new ApiError(
      'Invalid battery config: Target arrival cannot be higher than max charge SOC',
      400,
      { targetArrivalSOC, maxChargeSOC }
    );
  }

  if (startSOC > 100 || startSOC < 0) {
    throw new ApiError('Start SOC must be between 0 and 100', 400);
  }

  if (targetArrivalSOC < 0) {
    throw new ApiError('Target arrival SOC cannot be negative', 400);
  }

  if (maxChargeSOC < startSOC || maxChargeSOC > 100) {
    throw new ApiError('Max charge SOC must be between start SOC and 100', 400);
  }
}

module.exports = {
  ApiError,
  formatErrorResponse,
  validateRequired,
  validateBatteryParams,
};
