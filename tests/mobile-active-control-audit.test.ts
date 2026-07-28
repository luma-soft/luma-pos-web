import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const APP_ROOT = "src/app/(app)";
const INTERACTIVE_TAGS = new Set([
  "a",
  "Button",
  "button",
  "input",
  "label",
  "Link",
  "select",
  "summary",
  "textarea",
]);
const RISKY_MOBILE_SIZE =
  /^(?:h|size|min-h)-(?:8|9|10)$|^(?:p|py)-(?:1|1\.5|2|2\.5)$/;
const SAFE_MOBILE_SIZE =
  /^(?:h|size|min-h)-(?:1[1-9]|[2-9]\d)$|^(?:p|py)-(?:[3-9]|[1-9]\d)(?:\.5)?$/;

type Candidate = {
  file: string;
  line: number;
  tag: string;
  classes: string[];
};

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function jsxTagName(node: ts.JsxOpeningLikeElement) {
  return node.tagName.getText();
}

function isInteractiveTag(node: ts.JsxOpeningLikeElement) {
  const tag = jsxTagName(node);
  return (
    INTERACTIVE_TAGS.has(tag) ||
    tag.endsWith("Button") ||
    tag.endsWith("Link")
  );
}

function stringFragments(node: ts.Node): string[] {
  const fragments: string[] = [];
  const visit = (child: ts.Node) => {
    if (
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child)
    ) {
      fragments.push(child.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return fragments;
}

function classTokens(node: ts.JsxOpeningLikeElement) {
  const attribute = node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === "className",
  );
  if (!attribute?.initializer) return [];
  return stringFragments(attribute.initializer).flatMap((fragment) =>
    fragment.split(/\s+/).filter(Boolean),
  );
}

function isHiddenInput(node: ts.JsxOpeningLikeElement) {
  if (jsxTagName(node) !== "input") return false;
  const type = node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === "type",
  );
  return Boolean(
    type?.initializer &&
      ts.isStringLiteral(type.initializer) &&
      type.initializer.text === "hidden",
  );
}

function isDesktopOnly(node: ts.Node) {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      const opening = ts.isJsxElement(current)
        ? current.openingElement
        : current;
      const classes = classTokens(opening);
      if (
        classes.includes("hidden") &&
        classes.some((token) =>
          /^(?:sm|md|lg|xl|2xl):(?:block|flex|grid|inline|inline-flex|table|table-cell|table-row)$/.test(
            token,
          ),
        )
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function activeControlCandidates(): Candidate[] {
  const candidates: Candidate[] = [];
  for (const file of tsxFiles(APP_ROOT)) {
    const sourceText = readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        isInteractiveTag(node) &&
        !isHiddenInput(node) &&
        !isDesktopOnly(node)
      ) {
        const classes = classTokens(node);
        const tag = jsxTagName(node);
        const risky = classes.some((token) => {
          if (token.includes(":")) return false;
          if (tag === "Button") {
            return token === "h-auto" || /^(?:h|min-h)-(?:8|9|10)$/.test(token);
          }
          return RISKY_MOBILE_SIZE.test(token);
        });
        const safe = classes.some(
          (token) => !token.includes(":") && SAFE_MOBILE_SIZE.test(token),
        );
        const anchorLike = tag === "a" || tag.endsWith("Link");
        const sizedAnchor =
          classes.some((token) =>
            /^(?:block|flex|grid|inline-block|inline-flex)$/.test(token),
          ) || node.getText().includes("buttonVariants(");
        if (risky && (!safe || (anchorLike && !sizedAnchor))) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          candidates.push({
            file: relative(".", file),
            line: line + 1,
            tag,
            classes,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return candidates;
}

function compactClassConstants() {
  const failures: string[] = [];
  for (const file of tsxFiles(APP_ROOT)) {
    const sourceText = readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /(?:class|cls|field|input|button|btn|row|fi)/i.test(node.name.text) &&
        node.initializer &&
        (ts.isStringLiteral(node.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(node.initializer))
      ) {
        const classes = node.initializer.text.split(/\s+/).filter(Boolean);
        const risky = classes.some(
          (token) => !token.includes(":") && RISKY_MOBILE_SIZE.test(token),
        );
        const safe = classes.some(
          (token) => !token.includes(":") && SAFE_MOBILE_SIZE.test(token),
        );
        if (risky && !safe) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          failures.push(
            `${relative(".", file)}:${line + 1} ${node.name.text}=${node.initializer.text}`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return failures;
}

describe("mobile active-control audit", () => {
  test("direct mobile controls with compact sizing have a 44px base target", () => {
    const failures = activeControlCandidates().map(
      ({ file, line, tag, classes }) =>
        `${file}:${line} <${tag}> ${classes.join(" ")}`,
    );
    expect(failures).toEqual([]);
  });

  test("reused control class constants cannot hide compact mobile sizing", () => {
    expect(compactClassConstants()).toEqual([]);
  });

  test("shared compact controls keep a 44px mobile base and desktop density", () => {
    const buttons = readFileSync("src/components/ui/button-variants.ts", "utf8");
    const inputs = readFileSync("src/components/ui/input.tsx", "utf8");
    const selects = readFileSync("src/components/ui/select.tsx", "utf8");
    const quantities = readFileSync(
      "src/components/ui/quantity-input.tsx",
      "utf8",
    );

    expect(buttons).toContain('sm: "h-11 px-3 text-xs sm:h-8"');
    expect(buttons).toContain('iconSm: "h-11 w-11 sm:h-8 sm:w-8"');
    expect(inputs).toContain('sm: "h-11 px-2 text-base sm:h-8 sm:text-xs"');
    expect(selects).toContain('sm: "h-11 px-2.5 pr-8 text-base sm:h-8 sm:text-xs"');
    expect(selects).toContain(
      '"flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 sm:min-h-0"',
    );
    expect(quantities).toContain(
      '"grid shrink-0 grid-cols-[44px_minmax(44px,1fr)_44px]',
    );
    expect(quantities).toContain(
      'size === "sm" ? "h-11 sm:h-8" : "h-11 sm:h-10"',
    );
  });
});
