/**
 * Rate Limiter for Google API
 * STATUS: PROTECTED (High Performance + Daily Hard Cap)
 */

class RateLimiter {
  // 🟢 Added maxCallsPerDay (Default: 3000)
  constructor(maxCallsPerMinute = 300, windowMs = 60000, maxCallsPerDay = 3000) {
    this.maxCallsPerMinute = maxCallsPerMinute;
    this.windowMs = windowMs;
    this.maxCallsPerDay = maxCallsPerDay;

    // Minute Window Trackers
    this.callCount = 0;
    this.windowStart = Date.now();

    // Daily Window Trackers
    this.dailyCount = 0;
    this.currentDay = new Date().toLocaleDateString(); // e.g. "12/14/2025"
  }

  async wait() {
    const now = Date.now();
    const today = new Date().toLocaleDateString();

    // 1. DAILY RESET CHECK (Midnight Logic)
    if (today !== this.currentDay) {
        console.log(`[Rate Limiter] ☀️ New Day detected! Resetting daily count from ${this.dailyCount} to 0.`);
        this.dailyCount = 0;
        this.currentDay = today;
        this.callCount = 0; // Reset minute counter too
    }

    // 2. DAILY HARD CAP (The Kill Switch)
    if (this.dailyCount >= this.maxCallsPerDay) {
        console.warn(`[Rate Limiter] 🛑 DAILY QUOTA EXCEEDED (${this.dailyCount}/${this.maxCallsPerDay}). Request blocked.`);
        // We throw an error so the fetcher catches it and returns [] (empty list)
        throw new Error('Daily Google API Quota Exceeded');
    }

    // 3. MINUTE WINDOW LOGIC (Sliding Window)
    const windowElapsed = now - this.windowStart;

    if (windowElapsed > this.windowMs) {
      this.callCount = 0;
      this.windowStart = now;
      // console.log(`[Rate Limiter] Minute window reset.`);
    }

    if (this.callCount >= this.maxCallsPerMinute) {
      const waitTime = this.windowMs - windowElapsed + 500;
      console.log(
        `[Rate Limiter] ⚠️ Minute Speed Limit (${this.maxCallsPerMinute}) Hit. Pausing for ${(waitTime / 1000).toFixed(1)}s...`
      );
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      this.callCount = 0;
      this.windowStart = Date.now();
    }

    // Increment Counters
    this.callCount++;
    this.dailyCount++;
  }

  async executeWithLimit(fn) {
    try {
        await this.wait();
        return await fn();
    } catch (error) {
        if (error.message === 'Daily Google API Quota Exceeded') {
            return { data: { results: [] } }; // Return empty result silently
        }
        throw error;
    }
  }

  getStatus() {
    return {
      currentMinute: this.callCount,
      minuteLimit: this.maxCallsPerMinute,
      dailyUsed: this.dailyCount,
      dailyLimit: this.maxCallsPerDay,
      remainingToday: this.maxCallsPerDay - this.dailyCount
    };
  }
}

// 🟢 Export with 300 calls/min speed, but 3000 calls/day hard limit
const rateLimiter = new RateLimiter(300, 60000, 3000); 

module.exports = rateLimiter;