import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const APP_ROOT = "src/app/(app)";
const COMPONENT_ROOT = "src/components";
const GUARANTEED_SHARED_CONTROLS = new Set([
  "Button",
  "Combobox",
  "Input",
  "NumberInput",
  "QuantityInput",
  "SearchableSelect",
  "Select",
  "Textarea",
]);
const DIRECT_INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "Link",
  "select",
  "summary",
  "textarea",
]);
const PASSTHROUGH_CONTROL_LINKS = new Set(["OrderDetailLink"]);
const NATIVE_PRIMITIVE_IMPLEMENTATIONS = new Set([
  "src/components/order-detail-link.tsx",
  "src/components/ui/button.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/money-input.tsx",
  "src/components/ui/quantity-input.tsx",
]);
const PRE_LG_BREAKPOINTS = new Set(["sm", "md"]);

type Candidate = {
  file: string;
  line: number;
  tag: string;
  classes: string[];
  reason: string;
};

type LengthState = {
  fixed: boolean;
  min: boolean;
  padding: boolean;
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

function attribute(
  node: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function staticAttributeValue(
  node: ts.JsxOpeningLikeElement,
  name: string,
) {
  const found = attribute(node, name);
  return found?.initializer && ts.isStringLiteral(found.initializer)
    ? found.initializer.text
    : undefined;
}

function stringConstants(source: ts.SourceFile) {
  const constants = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      constants.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return constants;
}

function classTokens(
  node: ts.JsxOpeningLikeElement,
  constants: Map<string, string>,
) {
  const className = attribute(node, "className");
  if (!className?.initializer) return [];

  const fragments: string[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isTemplateExpression(child)) {
      fragments.push(child.head.text);
      for (const span of child.templateSpans) fragments.push(span.literal.text);
    } else if (
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child)
    ) {
      fragments.push(child.text);
    } else if (ts.isIdentifier(child)) {
      const resolved = constants.get(child.text);
      if (resolved) fragments.push(resolved);
    }
    ts.forEachChild(child, visit);
  };
  visit(className.initializer);
  return fragments.flatMap((fragment) =>
    fragment.split(/\s+/).filter(Boolean),
  );
}

function isInsideNamedFunction(node: ts.Node, name: string) {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) &&
      current.name?.text === name
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isHiddenInput(
  node: ts.JsxOpeningLikeElement,
  constants: Map<string, string>,
) {
  return (
    jsxTagName(node) === "input" &&
    (staticAttributeValue(node, "type") === "hidden" ||
      classTokens(node, constants).some((token) =>
        ["hidden", "sr-only"].includes(token),
      ))
  );
}

function isDataTableColumnRenderer(node: ts.Node) {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isVariableDeclaration(current) &&
      current.type?.getText().includes("DataTableColumn")
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isPrintOnly(
  node: ts.Node,
  constants: Map<string, string>,
) {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      const opening = ts.isJsxElement(current)
        ? current.openingElement
        : current;
      const classes = classTokens(opening, constants);
      if (
        classes.includes("hidden") &&
        classes.some((token) =>
          /^print:(?:block|flex|grid|inline|inline-flex|table)$/.test(token),
        )
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

function isDesktopOnly(
  node: ts.Node,
  constants: Map<string, string>,
) {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      const opening = ts.isJsxElement(current)
        ? current.openingElement
        : current;
      const classes = classTokens(opening, constants);
      if (
        classes.includes("hidden") &&
        classes.some((token) =>
          /^(?:lg|xl|2xl):(?:block|flex|grid|inline|inline-flex|table|table-cell|table-row)$/.test(
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

function containsChoiceInput(node: ts.Node) {
  let found = false;
  const visit = (child: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(child) ||
        ts.isJsxSelfClosingElement(child)) &&
      ["input", "Input"].includes(jsxTagName(child)) &&
      ["checkbox", "radio", "file", "color"].includes(
        staticAttributeValue(child, "type") ?? "",
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function isInteractive(
  node: ts.JsxOpeningLikeElement,
) {
  const tag = jsxTagName(node);
  if (
    DIRECT_INTERACTIVE_TAGS.has(tag) ||
    GUARANTEED_SHARED_CONTROLS.has(tag) ||
    PASSTHROUGH_CONTROL_LINKS.has(tag)
  ) {
    return true;
  }
  if (tag === "label") {
    return containsChoiceInput(node.parent);
  }
  return (
    Boolean(attribute(node, "onClick")) &&
    Boolean(attribute(node, "role") || attribute(node, "tabIndex")) &&
    ["div", "span", "article"].includes(tag)
  );
}

function insideInteractiveLabel(node: ts.Node) {
  let current = node.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      if (jsxTagName(current.openingElement) === "label") return true;
      if (isInteractive(current.openingElement)) return false;
    }
    current = current.parent;
  }
  return false;
}

function numericScaleIsSafe(value: string) {
  const arbitraryPx = value.match(/^\[(\d+(?:\.\d+)?)px\]$/);
  if (arbitraryPx) return Number(arbitraryPx[1]) >= 44;
  const arbitraryRem = value.match(/^\[(\d+(?:\.\d+)?)rem\]$/);
  if (arbitraryRem) return Number(arbitraryRem[1]) >= 2.75;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 11;
}

function widthValueIsSafe(value: string) {
  return (
    numericScaleIsSafe(value) ||
    ["full", "screen", "fit", "max", "min"].includes(value)
  );
}

function responsiveParts(token: string) {
  const parts = token.split(":");
  const breakpoint = PRE_LG_BREAKPOINTS.has(parts[0]) ? parts.shift() : "base";
  if (
    parts.some((part) =>
      /^(?:hover|focus|focus-visible|active|disabled|dark|group-hover|aria-)/.test(
        part,
      ),
    )
  ) {
    return null;
  }
  return { breakpoint, utility: parts.join(":") };
}

function applyLengthUtility(
  utility: string,
  axis: "vertical" | "horizontal",
  state: LengthState,
  allowContextualPadding: boolean,
) {
  const fixedPrefix = axis === "vertical" ? /^(?:h|size)-(.+)$/ : /^(?:w|size)-(.+)$/;
  const minPrefix = axis === "vertical" ? /^min-h-(.+)$/ : /^min-w-(.+)$/;
  const paddingPrefix = axis === "vertical" ? /^(?:p|py)-(.+)$/ : /^(?:p|px)-(.+)$/;
  const fixed = utility.match(fixedPrefix);
  const min = utility.match(minPrefix);
  const padding = utility.match(paddingPrefix);

  if (fixed) state.fixed = axis === "vertical"
    ? numericScaleIsSafe(fixed[1])
    : widthValueIsSafe(fixed[1]);
  if (min) state.min = axis === "vertical"
    ? numericScaleIsSafe(min[1])
    : widthValueIsSafe(min[1]);
  if (allowContextualPadding && padding) {
    const parsed = Number(padding[1]);
    state.padding = Number.isFinite(parsed) && parsed >= 3;
  }
}

function safeAtBaseAndTablet(
  classes: string[],
  axis: "vertical" | "horizontal",
  allowContextualPadding = false,
) {
  const state: LengthState = { fixed: false, min: false, padding: false };
  for (const breakpoint of ["base", "sm", "md"]) {
    for (const token of classes) {
      const parsed = responsiveParts(token);
      if (parsed?.breakpoint === breakpoint) {
        applyLengthUtility(
          parsed.utility,
          axis,
          state,
          allowContextualPadding,
        );
      }
    }
    if (!(state.fixed || state.min || state.padding)) return false;
  }
  return true;
}

function hasDisplayBox(classes: string[]) {
  return classes.some((token) =>
    /^(?:block|flex|grid|inline-block|inline-flex)$/.test(token),
  );
}

function hasVisibleText(node: ts.JsxOpeningLikeElement) {
  const fullNode = node.parent;
  if (!ts.isJsxElement(fullNode)) return false;
  const childHasText = (child: ts.JsxChild): boolean => {
    if (ts.isJsxText(child)) return child.text.trim().length > 0;
    if (ts.isJsxExpression(child)) return Boolean(child.expression);
    if (ts.isJsxElement(child)) return child.children.some(childHasText);
    return false;
  };
  return fullNode.children.some(childHasText);
}

function sharedControlHasUnsafeOverride(
  classes: string[],
) {
  if (
    classes.some((token) =>
      /^(?:sm|md):\[[^\]]+\]:(?:h|size|min-h|min-w|w)-(?:auto|0|[1-9]|10)$/.test(
        token,
      ),
    )
  ) {
    return true;
  }
  let minHeightSafe = false;
  for (const breakpoint of ["base", "sm", "md"]) {
    for (const token of classes) {
      const parsed = responsiveParts(token);
      if (parsed?.breakpoint !== breakpoint) continue;
      const minHeight = parsed.utility.match(/^min-h-(.+)$/);
      if (minHeight) minHeightSafe = numericScaleIsSafe(minHeight[1]);
    }
    if (
      !minHeightSafe &&
      classes.some((token) => {
        const parsed = responsiveParts(token);
        return (
          parsed?.breakpoint === breakpoint &&
          /^(?:h|size)-(?:auto|0|[1-9]|10)$/.test(parsed.utility)
        );
      })
    ) {
      return true;
    }
  }
  return false;
}

function ownHitArea(
  node: ts.JsxOpeningLikeElement,
  classes: string[],
  allowContextualTextWidth: boolean,
) {
  const tag = jsxTagName(node);
  if (
    classes.includes("fixed") &&
    classes.includes("inset-0")
  ) {
    return true;
  }
  if (node.getText().includes("buttonVariants(")) {
    return !sharedControlHasUnsafeOverride(classes);
  }
  if (GUARANTEED_SHARED_CONTROLS.has(tag)) {
    return (
      !sharedControlHasUnsafeOverride(classes) ||
      safeAtBaseAndTablet(
        classes,
        "vertical",
        allowContextualTextWidth,
      )
    );
  }

  const vertical = safeAtBaseAndTablet(
    classes,
    "vertical",
    allowContextualTextWidth,
  );
  const horizontal =
    safeAtBaseAndTablet(
      classes,
      "horizontal",
      allowContextualTextWidth,
    ) ||
    (allowContextualTextWidth && hasVisibleText(node));
  if (!vertical || !horizontal) return false;

  if (tag === "a" || tag === "Link" || PASSTHROUGH_CONTROL_LINKS.has(tag)) {
    return hasDisplayBox(classes) || node.getText().includes("buttonVariants(");
  }
  return true;
}

function outerHitArea(
  node: ts.JsxOpeningLikeElement,
  constants: Map<string, string>,
  allowContextualTextWidth: boolean,
) {
  let current = node.parent.parent;
  while (current) {
    if (ts.isJsxElement(current)) {
      const opening = current.openingElement;
      const tag = jsxTagName(opening);
      if (
        tag === "label" ||
        (tag === "Button" && attribute(opening, "asChild"))
      ) {
        return ownHitArea(
          opening,
          classTokens(opening, constants),
          allowContextualTextWidth,
        );
      }
      if (isInteractive(opening)) return false;
    }
    current = current.parent;
  }
  return false;
}

function auditSource(
  file: string,
  sourceText: string,
  onlySharedControlUsage = false,
  allowContextualTextWidth = false,
): Candidate[] {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const constants = stringConstants(source);
  const candidates: Candidate[] = [];

  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isInteractive(node) &&
      (!onlySharedControlUsage ||
        GUARANTEED_SHARED_CONTROLS.has(jsxTagName(node))) &&
      !isHiddenInput(node, constants) &&
      !NATIVE_PRIMITIVE_IMPLEMENTATIONS.has(file) &&
      !isDataTableColumnRenderer(node) &&
      !isInsideNamedFunction(node, "ColumnVisibilityMenu") &&
      !isDesktopOnly(node, constants) &&
      !isPrintOnly(node, constants)
    ) {
      const tag = jsxTagName(node);
      const inputType = staticAttributeValue(node, "type");
      const isNestedChoice =
        tag === "input" &&
        ["checkbox", "radio", "file", "color"].includes(inputType ?? "") &&
        insideInteractiveLabel(node);
      const classes = classTokens(node, constants);
      if (
        !isNestedChoice &&
        !ownHitArea(node, classes, allowContextualTextWidth) &&
        !outerHitArea(node, constants, allowContextualTextWidth)
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        candidates.push({
          file,
          line: line + 1,
          tag,
          classes,
          reason: classes.length === 0
            ? "no statically resolved hit-area classes"
            : "no >=44px mobile+tablet hit-area contract",
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return candidates;
}

function activeControlCandidates() {
  return [
    ...tsxFiles(APP_ROOT).flatMap((file) =>
      auditSource(relative(".", file), readFileSync(file, "utf8"), false, true),
    ),
    ...tsxFiles(COMPONENT_ROOT).flatMap((file) =>
      auditSource(relative(".", file), readFileSync(file, "utf8")),
    ),
  ];
}

function sharedControlOverrideCandidates() {
  return tsxFiles(COMPONENT_ROOT).flatMap((file) =>
    auditSource(
      relative(".", file),
      readFileSync(file, "utf8"),
      true,
    ),
  );
}

function descendantShrinkCandidates() {
  const failures: string[] = [];
  for (const root of [APP_ROOT, COMPONENT_ROOT]) {
    for (const file of tsxFiles(root)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const constants = stringConstants(source);
      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) ||
            ts.isJsxSelfClosingElement(node)) &&
          !isDesktopOnly(node, constants) &&
          !isPrintOnly(node, constants)
        ) {
          const shrinking = classTokens(node, constants).filter((token) =>
            /^(?:sm|md):\[[^\]]+\]:(?:h|size|min-h|min-w|w)-(?:auto|0|[1-9]|10)$/.test(
              token,
            ),
          );
          if (shrinking.length > 0) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart());
            failures.push(
              `${relative(".", file)}:${line + 1} ${shrinking.join(" ")}`,
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return failures;
}

function quantityWidthIsSafe(classes: string[]) {
  return classes.some((token) =>
    /^(?:w|min-w)-(?:full|\[132px\])$/.test(token),
  );
}

function touchTargetQuantityCandidates() {
  const failures: string[] = [];
  for (const root of [APP_ROOT, COMPONENT_ROOT]) {
    for (const file of tsxFiles(root)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const constants = stringConstants(source);
      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) ||
            ts.isJsxSelfClosingElement(node)) &&
          jsxTagName(node) === "QuantityInput" &&
          attribute(node, "touchTargets")
        ) {
          let allocated = quantityWidthIsSafe(classTokens(node, constants));
          let current: ts.Node | undefined = node.parent;
          while (!allocated && current) {
            if (ts.isJsxElement(current)) {
              const classes = classTokens(current.openingElement, constants);
              allocated =
                quantityWidthIsSafe(classes) ||
                classes.includes("col-span-2");
            }
            current = current.parent;
          }
          if (!allocated) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart());
            failures.push(`${relative(".", file)}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return failures;
}

function narrowQuantityOverrideCandidates() {
  const failures: string[] = [];
  for (const root of [APP_ROOT, COMPONENT_ROOT]) {
    for (const file of tsxFiles(root)) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const constants = stringConstants(source);
      const visit = (node: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(node) ||
            ts.isJsxSelfClosingElement(node)) &&
          jsxTagName(node) === "QuantityInput" &&
          !isDesktopOnly(node, constants)
        ) {
          const narrow = classTokens(node, constants).filter((token) => {
            const parsed = responsiveParts(token);
            if (!parsed || parsed.breakpoint === "base" && token.startsWith("lg:")) {
              return false;
            }
            const width = parsed.utility.match(/^w-(\d+)$/);
            const arbitrary = parsed.utility.match(/^w-\[(\d+)px\]$/);
            if (width) return Number(width[1]) * 4 < 132;
            if (arbitrary) return Number(arbitrary[1]) < 132;
            return false;
          });
          if (narrow.length > 0) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart());
            failures.push(
              `${relative(".", file)}:${line + 1} ${narrow.join(" ")}`,
            );
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return failures;
}

describe("mobile active-control audit oracle", () => {
  test("rejects controls whose width or height is only implied", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        export function Fixture() {
          return <div>
            <button onClick={() => {}}>unsized</button>
            <summary>classless</summary>
            <button className="border-b-2 pb-2">tab</button>
            <button className="w-20">width only</button>
            <button className="h-11">×</button>
            <button className="p-3"><Icon /></button>
            <button className="h-11 px-3">{dynamicLabel}</button>
            <button className="h-11 px-3 sm:h-8">shrinks at tablet</button>
            <SearchableSelect className="[&>button]:h-11 md:[&>button]:h-10" />
          </div>;
        }
      `,
    );
    expect(failures.map(({ tag }) => tag)).toEqual([
      "button",
      "summary",
      "button",
      "button",
      "button",
      "button",
      "button",
      "button",
      "SearchableSelect",
    ]);
  });

  test("accepts persistent pre-lg sizing, safe label wrappers, and lg-only surfaces", () => {
    expect(
      auditSource(
        "fixture.tsx",
        `
          export function Fixture() {
            return <div>
              <button className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">safe</button>
              <label className="flex min-h-11 min-w-11 items-center">
                <input type="checkbox" />
                safe choice
              </label>
              <div className="hidden lg:block">
                <button className="h-8 w-8">desktop only</button>
              </div>
              <button className="fixed inset-0">full-screen dismiss target</button>
            </div>;
          }
        `,
      ),
    ).toEqual([]);
  });
});

describe("mobile active-control audit", () => {
  test("every app and shared native mobile/tablet control has a 44px hit-area contract", () => {
    const failures = activeControlCandidates().map(
      ({ file, line, tag, classes, reason }) =>
        `${file}:${line} <${tag}> ${reason}: ${classes.join(" ")}`,
    );
    expect(failures).toEqual([]);
  });

  test("shared compact controls stay 44px until the lg desktop breakpoint", () => {
    const buttons = readFileSync("src/components/ui/button-variants.ts", "utf8");
    const inputs = readFileSync("src/components/ui/input.tsx", "utf8");
    const selects = readFileSync("src/components/ui/select.tsx", "utf8");
    const quantities = readFileSync(
      "src/components/ui/quantity-input.tsx",
      "utf8",
    );

    expect(buttons).toContain('sm: "h-11 px-3 text-xs lg:h-8"');
    expect(buttons).toContain('default: "h-11 px-4 py-2 text-sm lg:h-10"');
    expect(buttons).toContain('icon: "h-11 w-11 lg:h-10 lg:w-10"');
    expect(buttons).toContain('iconSm: "h-11 w-11 lg:h-8 lg:w-8"');
    expect(inputs).toContain('sm: "h-11 px-2 text-base lg:h-8 lg:text-xs"');
    expect(inputs).toContain('default: "h-11 text-base lg:h-10 lg:text-sm"');
    expect(selects).toContain('sm: "h-11 px-2.5 pr-8 text-base lg:h-8 lg:text-xs"');
    expect(selects).toContain('default: "h-11 px-3 pr-9 text-base lg:h-10 lg:text-sm"');
    expect(selects).toContain(
      '"flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 lg:min-h-0"',
    );
    expect(quantities).toContain(
      '"grid shrink-0 grid-cols-[44px_minmax(44px,1fr)_44px] overflow-hidden rounded-lg border border-border bg-surface lg:grid-cols-[32px_minmax(44px,1fr)_32px]"',
    );
    expect(quantities).toContain(
      'size === "sm" ? "h-11 lg:h-8" : "h-11 lg:h-10"',
    );
  });

  test("shared-control callsites do not override tablet-safe primitive sizing", () => {
    const failures = sharedControlOverrideCandidates().map(
      ({ file, line, tag, classes, reason }) =>
        `${file}:${line} <${tag}> ${reason}: ${classes.join(" ")}`,
    );
    expect(failures).toEqual([]);
  });

  test("pre-lg descendant selectors cannot silently shrink nested controls", () => {
    expect(descendantShrinkCandidates()).toEqual([]);
  });

  test("quantity integrations reserve all three touch tracks below lg", () => {
    expect(touchTargetQuantityCandidates()).toEqual([]);
    expect(narrowQuantityOverrideCandidates()).toEqual([]);
  });
});
