import { Worker } from "node:worker_threads";
import { parseFile } from "./parser.js";
import { config } from "./config.js";

export function createParserPool({
  workerCount = config.PARSER_WORKERS,
  parseImpl = parseFile,
} = {}) {
  const queue = [];
  const workers = [];
  let nextTaskId = 1;
  let closed = false;
  let fallbackActive = 0;
  const fallbackQueue = [];

  for (let index = 0; index < workerCount; index += 1) {
    const state = { worker: null, task: null, failed: false, restarts: 0 };
    try {
      startWorker(state);
    } catch {
      state.failed = true;
    }
    workers.push(state);
  }

  if (workerCount > 0 && workers.every((state) => state.failed)) {
    console.warn("Parser workers are unavailable; using concurrency 2");
  }

  function startWorker(state) {
    const worker = new Worker(new URL("./parserWorker.js", import.meta.url), {
      type: "module",
      execArgv: process.execArgv.filter((argument) =>
        !argument.startsWith("--input-type") &&
        argument !== "--test" &&
        !argument.startsWith("--test-"),
      ),
    });
    state.worker = worker;
    state.failed = false;
    worker.on("message", (message) => {
      const task = state.task;
      if (!task || task.id !== message.taskId) return;
      state.task = null;
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.result);
      dispatch();
    });
    worker.on("error", (error) => {
      if (state.worker === worker) failWorker(state, error);
    });
    worker.on("exit", (code) => {
      if (!closed && state.worker === worker)
        failWorker(state, new Error(`Parser worker exited with code ${code}`));
    });
  }

  function failWorker(state, error) {
    if (closed || state.failed) return;
    state.failed = true;
    state.worker = null;
    if (state.task) {
      queue.unshift(state.task);
      state.task = null;
    }
    try {
      if (state.restarts >= 1) throw error;
      state.restarts += 1;
      startWorker(state);
    } catch {
      state.failed = true;
    }
    if (error) console.warn("Parser worker failed; retrying queued files");
    dispatch();
  }

  function dispatch() {
    if (closed) return;
    for (const state of workers) {
      if (state.failed || state.task || !state.worker || queue.length === 0) continue;
      const task = queue.shift();
      state.task = task;
      try {
        state.worker.postMessage({
          taskId: task.id,
          source: task.source,
          filePath: task.filePath,
        });
      } catch (error) {
        state.task = null;
        task.reject(error);
        failWorker(state, error);
      }
    }
    if (workers.every((state) => state.failed)) {
      fallbackQueue.push(...queue.splice(0));
      drainFallback();
    }
  }

  function drainFallback() {
    while (!closed && fallbackActive < 2 && fallbackQueue.length > 0) {
      const task = fallbackQueue.shift();
      fallbackActive += 1;
      setImmediate(() => {
        try {
          task.resolve(parseImpl(task.source, task.filePath));
        } catch (error) {
          task.reject(error);
        } finally {
          fallbackActive -= 1;
          drainFallback();
        }
      });
    }
  }

  return {
    workerCount: workers.filter((state) => state.worker && !state.failed).length,
    parse(source, filePath) {
      return new Promise((resolve, reject) => {
        const task = {
          id: nextTaskId++,
          source,
          filePath,
          resolve,
          reject,
        };
        if (closed) return reject(new Error("Parser pool is closed"));
        if (workers.every((state) => state.failed)) {
          fallbackQueue.push(task);
          drainFallback();
        } else {
          queue.push(task);
          dispatch();
        }
      });
    },
    async close() {
      closed = true;
      const terminations = workers
        .filter((state) => state.worker)
        .map((state) => state.worker.terminate());
      await Promise.allSettled(terminations);
    },
  };
}
