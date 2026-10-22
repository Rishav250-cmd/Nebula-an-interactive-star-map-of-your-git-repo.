import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

function pluginsForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const plugins = ["decorators-legacy", "classProperties", "dynamicImport"];

  if (extension === ".ts" || extension === ".mts" || extension === ".cts") {
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

export function parseImports(source, filePath) {
  try {
    const ast = parse(source, {
      sourceType: "unambiguous",
      errorRecovery: true,
      allowAwaitOutsideFunction: true,
      plugins: pluginsForFile(filePath),
    });

    if (ast.errors.length > 0) {
      return { imports: [], error: ast.errors[0].message };
    }

    const imports = [];
    const seenSpecifiers = new Set();
    const addImport = (node, kind) => {
      const specifier = stringValue(node);
      if (specifier === null || seenSpecifiers.has(specifier)) return;

      seenSpecifiers.add(specifier);
      imports.push({ specifier, kind });
    };

    traverse(ast, {
      ImportDeclaration({ node }) {
        addImport(node.source, "import");
      },
      ExportNamedDeclaration({ node }) {
        if (node.source) addImport(node.source, "export-from");
      },
      ExportAllDeclaration({ node }) {
        if (node.source) addImport(node.source, "export-from");
      },
      CallExpression({ node }) {
        if (node.callee.type === "Import") {
          addImport(node.arguments[0], "dynamic");
        } else if (node.callee.type === "Identifier" && node.callee.name === "require") {
          addImport(node.arguments[0], "require");
        }
      },
      ImportExpression({ node }) {
        addImport(node.source, "dynamic");
      },
      TSImportEqualsDeclaration({ node }) {
        if (node.moduleReference.type === "TSExternalModuleReference") {
          addImport(node.moduleReference.expression, "require");
        }
      },
    });

    return { imports, error: null };
  } catch (error) {
    return { imports: [], error: error instanceof Error ? error.message : String(error) };
  }
}
