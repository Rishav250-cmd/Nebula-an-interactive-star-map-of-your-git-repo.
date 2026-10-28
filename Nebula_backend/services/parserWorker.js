import { parentPort } from "node:worker_threads";
import { parseFile } from "./parser.js";

parentPort.on("message", ({ taskId, source, filePath }) => {
  try {
    parentPort.postMessage({ taskId, result: parseFile(source, filePath) });
  } catch (error) {
    parentPort.postMessage({
      taskId,
      error: error?.message ?? String(error),
    });
  }
});
