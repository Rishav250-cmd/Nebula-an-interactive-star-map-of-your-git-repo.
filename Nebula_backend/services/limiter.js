import { config } from "./config.js";
import { NebulaError } from "./errors.js";

export function createJobLimiter({
  maxConcurrent = config.MAX_CONCURRENT_JOBS,
  maxQueue = config.MAX_QUEUE,
} = {}) {
  let active = 0;
  const queue = [];
  const reservations = new Set();

  function busyError() {
    return new NebulaError("BUSY", { retryAfter: 15 });
  }

  function reserve() {
    if (active + queue.length + reservations.size >= maxConcurrent + maxQueue)
      throw busyError();
    const reservation = { queued: active >= maxConcurrent || queue.length > 0 };
    reservations.add(reservation);
    return reservation;
  }

  function run(task, { onQueued } = {}) {
    if (active + queue.length + reservations.size >= maxConcurrent + maxQueue)
      throw busyError();
    if (active < maxConcurrent && queue.length === 0) {
      return startTask(task);
    }
    if (queue.length + reservations.size >= maxQueue) throw busyError();
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject, onQueued });
      onQueued?.();
    });
  }

  function runReserved(reservation, task, options = {}) {
    if (!reservations.delete(reservation)) throw new Error("Invalid job reservation");
    return run(task, options);
  }

  function cancelReservation(reservation) {
    return reservations.delete(reservation);
  }

  function startTask(task) {
    active += 1;
    return Promise.resolve()
      .then(task)
      .finally(() => {
        active -= 1;
        dispatch();
      });
  }

  function dispatch() {
    while (active < maxConcurrent && queue.length > 0) {
      const item = queue.shift();
      startTask(item.task).then(item.resolve, item.reject);
    }
  }

  return {
    reserve,
    run,
    runReserved,
    cancelReservation,
    getState: () => ({ active, queued: queue.length, reserved: reservations.size }),
  };
}

export function createIpRateLimiter({
  maxRequests = config.RATE_LIMIT_MAX,
  windowMs = config.RATE_LIMIT_WINDOW_MS,
  now = Date.now,
  shouldSkip = () => false,
} = {}) {
  const records = new Map();

  return function rateLimit(request, _response, next) {
    if (shouldSkip(request)) return next();
    const currentTime = now();
    for (const [ip, record] of records) {
      if (record.resetAt <= currentTime) records.delete(ip);
    }

    const ip = request.ip || request.socket?.remoteAddress || "unknown";
    let record = records.get(ip);
    if (!record || record.resetAt <= currentTime) {
      record = { count: 0, resetAt: currentTime + windowMs };
      records.set(ip, record);
    }
    if (record.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((record.resetAt - currentTime) / 1000));
      return next(new NebulaError("RATE_LIMITED", { retryAfter }));
    }
    record.count += 1;
    return next();
  };
}
