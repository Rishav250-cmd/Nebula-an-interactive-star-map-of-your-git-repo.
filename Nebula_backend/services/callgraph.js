import { resolveImport } from "./resolver.js";

const MAX_NODES = 150;

/**
 * Build a function call graph rooted at every function in one repository file.
 *
 * @param {{ files: Record<string, { functions: object[], calls: object[], bindings: Map<string, object> }> }} analysis
 * @param {{ nodes: { id: string }[] }} graph
 * @param {string} filePath
 * @param {{ depth?: number }} options
 * @returns {{ file: string, depth: number, nodes: object[], edges: object[], truncated: boolean }}
 */
export function buildCallGraph(analysis, graph, filePath, { depth = 1 } = {}) {
  const maxDepth = Number.isInteger(depth) && depth > 0 ? depth : 1;
  const fileAnalyses = analysis?.files ?? {};
  const fileSet = new Set([
    ...(Array.isArray(graph?.nodes) ? graph.nodes.map((node) => node.id) : []),
    ...Object.keys(fileAnalyses),
  ]);
  const rootFunctions = fileAnalyses[filePath]?.functions ?? [];
  const nodes = [];
  const nodesById = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const queue = [];
  const queued = new Set();
  const expanded = new Set();
  const callsByFile = new Map();
  const functionsByNameByFile = new Map();
  let truncated = false;

  const addNode = (fn, file, external) => {
    if (nodesById.has(fn.id)) return true;
    if (nodes.length >= MAX_NODES) {
      truncated = true;
      return false;
    }

    const node = {
      id: fn.id,
      name: fn.name,
      kind: fn.kind,
      file,
      line: fn.line,
      endLine: fn.endLine,
      complexity: fn.complexity,
      external,
    };
    nodes.push(node);
    nodesById.set(fn.id, node);
    return true;
  };

  for (const fn of rootFunctions) {
    if (!addNode(fn, filePath, false)) continue;
    queue.push({ fn, file: filePath, level: 0 });
    queued.add(fn.id);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.level >= maxDepth || expanded.has(current.fn.id)) continue;
    expanded.add(current.fn.id);

    const calls =
      getCallsByCaller(fileAnalyses, callsByFile, current.file).get(
        current.fn.id,
      ) ?? [];
    for (const call of calls) {
      const target = resolveCall(
        current.fn,
        current.file,
        call,
        fileAnalyses,
        functionsByNameByFile,
        fileSet,
        analysis?.aliases ?? [],
      );
      if (!target) continue;

      const isExternal = target.file !== filePath;
      if (!addNode(target.fn, target.file, isExternal)) continue;

      const edgeKey = `${current.fn.id}\0${target.fn.id}`;
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edges.push({
          source: current.fn.id,
          target: target.fn.id,
          type: "call",
        });
      }

      const targetLevel = current.level + 1;
      if (
        isExternal &&
        targetLevel < maxDepth &&
        !expanded.has(target.fn.id) &&
        !queued.has(target.fn.id)
      ) {
        queue.push({ fn: target.fn, file: target.file, level: targetLevel });
        queued.add(target.fn.id);
      }
    }
  }

  return { file: filePath, depth: maxDepth, nodes, edges, truncated };
}

function resolveCall(
  caller,
  callerFile,
  call,
  fileAnalyses,
  functionsByNameByFile,
  fileSet,
  aliases,
) {
  const callerFunctions = getFunctionsByName(
    fileAnalyses,
    functionsByNameByFile,
    callerFile,
  );
  const localName =
    call.object === "this" && caller.parent
      ? `${caller.parent}.${call.property}`
      : call.name;
  const localFunction = callerFunctions.get(localName);
  if (localFunction) return { file: callerFile, fn: localFunction };

  if (call.object === "this") return null;

  const bindingName = call.object ?? call.name;
  const binding = getBinding(fileAnalyses[callerFile]?.bindings, bindingName);
  if (!binding) return null;

  const targetFile = resolveImport(binding.source, callerFile, fileSet, {
    aliases,
  });
  if (!targetFile) return null;

  const targetFunctions = getFunctionsByName(
    fileAnalyses,
    functionsByNameByFile,
    targetFile,
  );
  let targetFunction;

  if (call.object !== null && ["*", "default"].includes(binding.imported)) {
    const names = new Set([
      call.property,
      `exports.${call.property}`,
      `module.exports.${call.property}`,
    ]);
    targetFunction = [...names]
      .map((name) => targetFunctions.get(name))
      .find((fn) => fn?.exported);
  } else if (call.object === null && binding.imported === "default") {
    targetFunction = [...targetFunctions.values()].find(
      (fn) => fn.exported && fn.isDefaultExport,
    );
  } else if (call.object === null && binding.imported !== "*") {
    targetFunction = targetFunctions.get(binding.imported);
    if (!targetFunction?.exported) targetFunction = null;
  }

  return targetFunction ? { file: targetFile, fn: targetFunction } : null;
}

function getBinding(bindings, name) {
  if (bindings instanceof Map) return bindings.get(name) ?? null;
  return bindings?.[name] ?? null;
}

function getCallsByCaller(fileAnalyses, cache, file) {
  if (cache.has(file)) return cache.get(file);

  const callsByCaller = new Map();
  for (const call of fileAnalyses[file]?.calls ?? []) {
    const calls = callsByCaller.get(call.callerId) ?? [];
    calls.push(call);
    callsByCaller.set(call.callerId, calls);
  }
  cache.set(file, callsByCaller);
  return callsByCaller;
}

function getFunctionsByName(fileAnalyses, cache, file) {
  if (cache.has(file)) return cache.get(file);

  const functionsByName = new Map();
  for (const fn of fileAnalyses[file]?.functions ?? []) {
    if (!functionsByName.has(fn.name)) functionsByName.set(fn.name, fn);
  }
  cache.set(file, functionsByName);
  return functionsByName;
}
