import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

function pluginsForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const plugins = ["decorators-legacy", "classProperties", "dynamicImport"];

  if ([".ts", ".mts", ".cts"].includes(extension)) {
    plugins.push("typescript");
  } else if (extension === ".tsx") {
    plugins.push("typescript", "jsx");
  } else if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    plugins.push("jsx");
  }

  return plugins;
}

function stringValue(node) {
  return node?.type === "StringLiteral" ? node.value : null;
}

function identifierName(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "PrivateName") return node.id.name;
  if (node?.type === "StringLiteral") return node.value;
  if (node?.type === "NumericLiteral") return String(node.value);
  return null;
}

function methodKeyName(node) {
  return node?.type === "PrivateName"
    ? `#${node.id.name}`
    : identifierName(node);
}

/**
 * Parse imports and function-level symbols from one Babel traversal.
 *
 * @returns {{ imports: {specifier: string, kind: string}[], bindings: Map<string, {source: string, imported: string}>, functions: object[], calls: object[], complexity: number, error: string | null }}
 */
export function parseFile(source, filePath) {
  try {
    const ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowAwaitOutsideFunction: true,
      plugins: pluginsForFile(filePath),
    });

    if (ast.errors.length > 0) return emptyResult(ast.errors[0].message);

    const imports = [];
    const seenSpecifiers = new Set();
    const bindings = new Map();
    const functions = [];
    const calls = [];
    const functionStack = [];
    const classStack = [];
    const functionRecords = [];
    const namedExports = new Map();
    let complexity = 1;

    const addImport = (node, kind) => {
      const specifier = stringValue(node);
      if (specifier === null || seenSpecifiers.has(specifier)) return;

      seenSpecifiers.add(specifier);
      imports.push({ specifier, kind });
    };

    const addBinding = (local, source, imported) => {
      if (typeof local === "string" && local !== "") {
        bindings.set(local, { source, imported });
      }
    };

    const isInsideExport = (path) => {
      for (
        let current = path.parentPath;
        current;
        current = current.parentPath
      ) {
        if (
          current.isExportNamedDeclaration() ||
          current.isExportDefaultDeclaration()
        )
          return true;
        if (
          current.isProgram() ||
          current.isFunction() ||
          current.isClassDeclaration() ||
          current.isClassExpression()
        ) {
          break;
        }
      }
      return false;
    };

    const isDefaultExport = (path) =>
      path.parentPath?.isExportDefaultDeclaration() === true;

    const commonJsExport = (path) => {
      const parent = path.parentPath;
      if (!parent?.isAssignmentExpression() || parent.node.right !== path.node)
        return null;

      const left = parent.node.left;
      if (left.type !== "MemberExpression" || left.computed) return null;

      const property = identifierName(left.property);
      const object = left.object;
      if (
        object.type === "MemberExpression" &&
        !object.computed &&
        object.object.type === "Identifier" &&
        object.object.name === "module" &&
        identifierName(object.property) === "exports"
      ) {
        return property === null
          ? null
          : { name: property, isDefaultExport: false, exported: true };
      }

      if (object.type === "Identifier" && object.name === "exports") {
        return property === null
          ? null
          : { name: property, isDefaultExport: false, exported: true };
      }

      if (
        object.type === "Identifier" &&
        object.name === "module" &&
        property === "exports"
      ) {
        return { name: "default", isDefaultExport: true, exported: true };
      }

      return null;
    };

    const isExported = (path, kind) => {
      if (kind !== "method") return isInsideExport(path);

      for (
        let current = path.parentPath;
        current;
        current = current.parentPath
      ) {
        if (current.isClassDeclaration() || current.isClassExpression()) {
          return commonJsExport(current)?.exported ?? isInsideExport(current);
        }
        if (current.isProgram() || current.isFunction()) break;
      }
      return isInsideExport(path);
    };

    const assignedName = (path) => {
      const parent = path.parentPath;
      if (parent?.isVariableDeclarator() && parent.node.init === path.node) {
        return identifierName(parent.node.id);
      }
      if (parent?.isAssignmentExpression() && parent.node.right === path.node) {
        const exported = commonJsExport(path);
        if (exported) return exported.name;
        if (parent.node.left.type === "Identifier")
          return parent.node.left.name;
      }
      return null;
    };

    const exportMetadata = (path, kind) => {
      const commonJs = commonJsExport(path);
      return {
        exported: commonJs?.exported ?? isExported(path, kind),
        isDefaultExport:
          kind === "method"
            ? false
            : (commonJs?.isDefaultExport ?? isDefaultExport(path)),
      };
    };

    const addFunction = (
      path,
      { name, kind = "function", parent = null, localName = null },
    ) => {
      if (!path.node.body) return null;

      const { exported, isDefaultExport: defaultExport } = exportMetadata(
        path,
        kind,
      );
      const line = path.node.loc?.start.line ?? 1;
      const entry = {
        id: `${filePath}#${name}:${line}`,
        name,
        kind,
        line,
        endLine: path.node.loc?.end.line ?? line,
        complexity: 1,
        parent,
        exported,
        isDefaultExport: defaultExport,
      };
      functions.push(entry);
      functionRecords.push({ entry, localName });
      const frame = { node: path.node, entry };
      functionStack.push(frame);
      return frame;
    };

    const enterFunction = (path, nodeKind) => {
      const node = path.node;
      const defaultExport = isDefaultExport(path);
      const commonJs = commonJsExport(path);
      const variableName = assignedName(path);
      const inferredName =
        nodeKind === "declaration"
          ? (identifierName(node.id) ??
            (defaultExport ? "default" : "<anonymous>"))
          : (identifierName(node.id) ??
            variableName ??
            (defaultExport ? "default" : null) ??
            commonJs?.name ??
            "<anonymous>");
      return addFunction(path, {
        name: inferredName,
        kind: "function",
        localName:
          variableName ??
          (nodeKind === "declaration" ? identifierName(node.id) : null),
      });
    };

    const exitFunction = (path) => {
      if (functionStack.at(-1)?.node === path.node) functionStack.pop();
    };

    const enterClass = (path) => {
      const node = path.node;
      const defaultExport = isDefaultExport(path);
      const commonJs = commonJsExport(path);
      const variableName = assignedName(path);
      const name =
        identifierName(node.id) ??
        variableName ??
        (defaultExport ? "default" : null) ??
        commonJs?.name ??
        "<anonymous>";
      const parent = classStack.at(-1)?.name ?? null;
      const entry = {
        id: `${filePath}#${name}:${node.loc?.start.line ?? 1}`,
        name,
        kind: "class",
        line: node.loc?.start.line ?? 1,
        endLine: node.loc?.end.line ?? node.loc?.start.line ?? 1,
        complexity: 0,
        parent,
        exported: commonJs?.exported ?? isInsideExport(path),
        isDefaultExport: commonJs?.isDefaultExport ?? defaultExport,
      };
      functions.push(entry);
      functionRecords.push({
        entry,
        localName: variableName ?? identifierName(node.id),
      });
      classStack.push({ node, name, entry, methodEntries: [] });
    };

    const exitClass = (path) => {
      const record = classStack.at(-1);
      if (record?.node !== path.node) return;
      record.entry.complexity = record.methodEntries.reduce(
        (total, method) => total + method.complexity,
        0,
      );
      classStack.pop();
    };

    const enterClassMethod = (path) => {
      if (!path.node.body) return null;
      const owner = classStack.at(-1) ?? null;
      const method = methodKeyName(path.node.key) ?? "<computed>";
      const name = owner ? `${owner.name}.${method}` : method;
      const frame = addFunction(path, {
        name,
        kind: "method",
        parent: owner?.name ?? null,
      });
      if (frame && owner) owner.methodEntries.push(frame.entry);
      return frame;
    };

    const enterObjectMethod = (path) => {
      if (!path.node.body) return null;
      const method = methodKeyName(path.node.key) ?? "<computed>";
      const objectName = objectLiteralOwner(path);
      return addFunction(path, {
        name: objectName ? `${objectName}.${method}` : method,
        kind: "method",
      });
    };

    const objectLiteralOwner = (path) => {
      const objectPath = path.parentPath;
      if (!objectPath?.isObjectExpression()) return null;
      const parent = objectPath.parentPath;
      if (
        parent?.isVariableDeclarator() &&
        parent.node.init === objectPath.node
      ) {
        return identifierName(parent.node.id);
      }
      if (
        parent?.isAssignmentExpression() &&
        parent.node.right === objectPath.node
      ) {
        return (
          identifierName(parent.node.left) ?? commonJsExport(path)?.name ?? null
        );
      }
      return null;
    };

    const enterClassPropertyFunction = (path) => {
      const owner = classStack.at(-1) ?? null;
      const method = methodKeyName(path.parentPath.node.key) ?? "<computed>";
      const frame = addFunction(path, {
        name: owner ? `${owner.name}.${method}` : method,
        kind: "method",
        parent: owner?.name ?? null,
      });
      if (frame && owner) owner.methodEntries.push(frame.entry);
      return frame;
    };

    const addImportedBindings = (node) => {
      const source = stringValue(node.source);
      if (source === null) return;

      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportDefaultSpecifier") {
          addBinding(specifier.local.name, source, "default");
        } else if (specifier.type === "ImportNamespaceSpecifier") {
          addBinding(specifier.local.name, source, "*");
        } else if (specifier.type === "ImportSpecifier") {
          addBinding(
            specifier.local.name,
            source,
            identifierName(specifier.imported) ?? "default",
          );
        }
      }
    };

    const requireSource = (node) => {
      if (
        node?.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "require"
      ) {
        return stringValue(node.arguments[0]);
      }
      return null;
    };

    const addRequiredBindings = (declarator) => {
      const source = requireSource(declarator.init);
      if (source === null) return;

      if (declarator.id.type === "Identifier") {
        addBinding(declarator.id.name, source, "*");
      } else if (declarator.id.type === "ObjectPattern") {
        for (const property of declarator.id.properties) {
          if (property.type !== "ObjectProperty") continue;
          const imported = identifierName(property.key);
          const local = identifierName(property.value);
          if (imported !== null && local !== null)
            addBinding(local, source, imported);
        }
      }
    };

    const addCall = (path) => {
      const callee = path.node.callee;
      let name;
      let object = null;
      let property = null;

      if (callee.type === "Identifier") {
        name = callee.name;
      } else if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.type === "Identifier" &&
        (callee.object.type === "Identifier" ||
          callee.object.type === "ThisExpression")
      ) {
        object =
          callee.object.type === "ThisExpression" ? "this" : callee.object.name;
        property = callee.property.name;
        name = `${object}.${property}`;
      } else {
        return;
      }

      calls.push({
        callerId: functionStack.at(-1)?.entry.id ?? "<module>",
        name,
        object,
        property,
        line: path.node.loc?.start.line ?? 1,
      });
    };

    const addDecision = () => {
      complexity += 1;
      const current = functionStack.at(-1);
      if (current) current.entry.complexity += 1;
    };

    traverse(ast, {
      ImportDeclaration({ node }) {
        addImport(node.source, "import");
        addImportedBindings(node);
      },
      ExportNamedDeclaration({ node }) {
        if (node.source) {
          addImport(node.source, "export-from");
        } else {
          for (const specifier of node.specifiers) {
            if (specifier.type !== "ExportSpecifier") continue;
            const local = identifierName(specifier.local);
            const exported = identifierName(specifier.exported);
            if (local !== null) namedExports.set(local, exported === "default");
          }
        }
      },
      ExportAllDeclaration({ node }) {
        if (node.source) addImport(node.source, "export-from");
      },
      CallExpression: {
        enter(path) {
          const { node } = path;
          if (node.callee.type === "Import")
            addImport(node.arguments[0], "dynamic");
          else if (
            node.callee.type === "Identifier" &&
            node.callee.name === "require"
          ) {
            addImport(node.arguments[0], "require");
          }
          addCall(path);
        },
      },
      NewExpression: { enter: addCall },
      ImportExpression({ node }) {
        addImport(node.source, "dynamic");
      },
      TSImportEqualsDeclaration({ node }) {
        if (node.moduleReference.type === "TSExternalModuleReference") {
          const source = stringValue(node.moduleReference.expression);
          addImport(node.moduleReference.expression, "require");
          if (source !== null) addBinding(node.id.name, source, "*");
        }
      },
      VariableDeclarator({ node }) {
        addRequiredBindings(node);
      },
      FunctionDeclaration: {
        enter(path) {
          enterFunction(path, "declaration");
        },
        exit: exitFunction,
      },
      FunctionExpression: {
        enter(path) {
          enterFunction(path, "expression");
        },
        exit: exitFunction,
      },
      ArrowFunctionExpression: {
        enter(path) {
          const parent = path.parentPath;
          const classProperty =
            parent?.isClassProperty() ||
            parent?.isClassPrivateProperty() ||
            parent?.isClassAccessorProperty();
          if (classProperty) {
            enterClassPropertyFunction(path);
            return;
          }
          enterFunction(path, "expression");
        },
        exit: exitFunction,
      },
      ClassDeclaration: {
        enter(path) {
          enterClass(path);
        },
        exit(path) {
          exitClass(path);
        },
      },
      ClassExpression: {
        enter(path) {
          enterClass(path);
        },
        exit(path) {
          exitClass(path);
        },
      },
      ClassMethod: {
        enter(path) {
          enterClassMethod(path);
        },
        exit: exitFunction,
      },
      ClassPrivateMethod: {
        enter(path) {
          enterClassMethod(path);
        },
        exit: exitFunction,
      },
      ObjectMethod: {
        enter(path) {
          enterObjectMethod(path);
        },
        exit: exitFunction,
      },
      IfStatement: addDecision,
      ForStatement: addDecision,
      ForInStatement: addDecision,
      ForOfStatement: addDecision,
      WhileStatement: addDecision,
      DoWhileStatement: addDecision,
      CatchClause: addDecision,
      ConditionalExpression: addDecision,
      LogicalExpression({ node }) {
        if (["&&", "||", "??"].includes(node.operator)) addDecision();
      },
      SwitchCase({ node }) {
        if (node.test !== null) addDecision();
      },
    });

    for (const { entry, localName } of functionRecords) {
      if (localName !== null && namedExports.has(localName)) {
        entry.exported = true;
        if (namedExports.get(localName)) entry.isDefaultExport = true;
      }
    }

    return { imports, bindings, functions, calls, complexity, error: null };
  } catch (error) {
    return emptyResult(error instanceof Error ? error.message : String(error));
  }
}

export function parseImports(source, filePath) {
  const { imports, error } = parseFile(source, filePath);
  return { imports, error };
}

function emptyResult(error) {
  return {
    imports: [],
    bindings: new Map(),
    functions: [],
    calls: [],
    complexity: 0,
    error,
  };
}
