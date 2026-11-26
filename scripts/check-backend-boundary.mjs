// The web bundles backend source only from database-free modules (through
// the @/* fallback to vendor/backend/src and @backend/*). Fails, with the
// import chain, when web code reaches database code by a value import;
// such modules must be listed in the backend's src/lib/web-rpc/modules.json
// so the web gets a proxy instead. Run: node scripts/check-backend-boundary.mjs
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const web = path.resolve(process.argv[2] ?? ".");
const webSrc = path.join(web, "src");
const backendSrc = path.join(web, "vendor/backend/src");
const DB_PACKAGES = new Set(["pg", "postgres", "drizzle-orm/node-postgres", "@vercel/functions"]);
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx"];

function file(base) {
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolve(from, specifier) {
  if (specifier.startsWith("@backend/")) return file(path.join(backendSrc, specifier.slice(9)));
  if (specifier.startsWith("@/")) {
    // Backend files use @backend/*; @/ inside them never occurs, but stay strict.
    return file(path.join(webSrc, specifier.slice(2))) ?? file(path.join(backendSrc, specifier.slice(2)));
  }
  if (specifier.startsWith(".")) return file(path.resolve(path.dirname(from), specifier));
  return null;
}

function valueImports(fileName) {
  const sourceFile = ts.createSourceFile(fileName, fs.readFileSync(fileName, "utf8"), ts.ScriptTarget.Latest, false);
  const found = [];
  const visit = (node) => {
    let specifier;
    let typeOnly = false;
    if (ts.isImportDeclaration(node)) {
      specifier = node.moduleSpecifier.text;
      const clause = node.importClause;
      typeOnly = !!clause && (clause.isTypeOnly || (!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly)));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      specifier = node.moduleSpecifier.text;
      typeOnly = node.isTypeOnly;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      specifier = node.arguments[0].text;
    }
    if (specifier && !typeOnly) found.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

const roots = [];
(function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) roots.push(full);
  }
})(webSrc);

const parent = new Map();
const queue = [...roots];
for (const root of roots) parent.set(root, null);
const problems = [];
while (queue.length) {
  const current = queue.shift();
  for (const specifier of valueImports(current)) {
    if (DB_PACKAGES.has(specifier)) {
      problems.push({ file: current, specifier });
      continue;
    }
    const target = resolve(current, specifier);
    if (!target || parent.has(target)) continue;
    parent.set(target, current);
    queue.push(target);
  }
}

const relative = (fileName) => path.relative(web, fileName);
for (const problem of problems) {
  const chain = [];
  for (let at = problem.file; at; at = parent.get(at)) chain.unshift(relative(at));
  console.error(`database code reached: ${chain.join(" → ")} → ${problem.specifier}`);
}
const fromBackend = [...parent.keys()].filter((fileName) => fileName.startsWith(backendSrc)).length;
console.log(`${roots.length} web modules, ${fromBackend} database-free backend modules bundled, ${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
