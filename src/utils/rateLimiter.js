/**
 * Rate Limiter for Google API
 * Ensures max 50 Google Places calls per minute
 * Adds delays between API calls to prevent throttling
 * 
 * RULE #1 Implementation: Never exceed 50 Google API calls/minute
 */

class RateLimiter {
  constructor(maxCallsPerMinute = 50, windowMs = 60000) {
    this.maxCallsPerMinute = maxCallsPerMinute;
    this.windowMs = windowMs;
    this.callCount = 0;
    this.windowStart = Date.now();
    this.callHistory = [];
  }

  async wait() {
    const now = Date.now();
    const windowElapsed = now - this.windowStart;

    // Reset counter every 60 seconds
    if (windowElapsed > this.windowMs) {
      this.callCount = 0;
      this.windowStart = now;
      this.callHistory = [];
      console.log(`[Rate Limiter] Window reset. Ready for next batch.`);
    }

    // If we've hit the limit, wait until window resets
    if (this.callCount >= this.maxCallsPerMinute) {
      const waitTime = this.windowMs - windowElapsed + 500;
      console.log(
        `[Rate Limiter] ⚠️  Hit limit of ${this.maxCallsPerMinute} calls. ` +
        `Waiting ${(waitTime / 1000).toFixed(1)}s until window resets...`
      );
      
      // Wait and then reset
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.callCount = 0;
      this.windowStart = Date.now();
      this.callHistory = [];
    }

    this.callCount++;
    const timestamp = new Date().toISOString();
    this.callHistory.push(timestamp);
    
    console.log(
      `[Rate Limiter] Call ${this.callCount}/${this.maxCallsPerMinute} at ${timestamp}`
    );
  }

  async executeWithLimit(fn, delayMs = 200) {
    // Wait for rate limit
    await this.wait();
    
    // Add delay between calls
    await new Promise(resolve => setTimeout(resolve, delayMs));
    
    // Execute the function
    return fn();
  }

  getStatus() {
    return {
      currentCount: this.callCount,
      maxPerWindow: this.maxCallsPerMinute,
      windowMs: this.windowMs,
      remaining: Math.max(0, this.maxCallsPerMinute - this.callCount),
      callHistory: this.callHistory,
    };
  }
}

// Create singleton instance
const rateLimiter = new RateLimiter(50, 60000);

module.exports = rateLimiter;
