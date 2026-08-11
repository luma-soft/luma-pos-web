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
  "MoneyInput",
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
  "src/components/ui/quantity-input.tsx",
]);
const PRE_LG_BREAKPOINTS = new Set(["sm", "md"]);
const MAX_CLASS_SCENARIOS = 64;
const UNKNOWN_CLASS_SCENARIO = "__mobile_audit_unknown_class_scenario__";

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
    if (
      ts.isBinaryExpression(child) &&
      child.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      visit(child.left);
      return;
    }
    if (ts.isConditionalExpression(child)) {
      visit(child.condition);
      return;
    }
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

function classTokenScenarios(
  node: ts.JsxOpeningLikeElement,
  constants: Map<string, string>,
) {
  const className = attribute(node, "className");
  if (!className?.initializer) return [[]];
  const tokens = (value: string) => value.split(/\s+/).filter(Boolean);
  const unknown = () => [[UNKNOWN_CLASS_SCENARIO]];
  const bounded = (values: string[][]) => {
    const unique = new Map<string, string[]>();
    for (const value of values) {
      unique.set(value.join("\u0000"), value);
      if (unique.size > MAX_CLASS_SCENARIOS) return unknown();
    }
    return [...unique.values()];
  };
  const combine = (left: string[][], right: string[][]) => {
    if (left.length * right.length > MAX_CLASS_SCENARIOS) {
      return unknown();
    }
    const combined: string[][] = [];
    for (const a of left) {
      for (const b of right) {
        combined.push([...a, ...b]);
      }
    }
    return bounded(combined);
  };
  const staticTruthiness = (child: ts.Expression): boolean | undefined => {
    if (child.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (
      child.kind === ts.SyntaxKind.FalseKeyword ||
      child.kind === ts.SyntaxKind.NullKeyword
    ) {
      return false;
    }
    if (ts.isParenthesizedExpression(child)) {
      return staticTruthiness(child.expression);
    }
    if (
      ts.isPrefixUnaryExpression(child) &&
      child.operator === ts.SyntaxKind.ExclamationToken
    ) {
      const operand = staticTruthiness(child.operand);
      return operand === undefined ? undefined : !operand;
    }
    if (ts.isNumericLiteral(child)) return Number(child.text) !== 0;
    if (
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child)
    ) {
      return child.text.length > 0;
    }
    if (
      ts.isObjectLiteralExpression(child) ||
      ts.isArrayLiteralExpression(child) ||
      ts.isArrowFunction(child) ||
      ts.isFunctionExpression(child) ||
      ts.isClassExpression(child)
    ) {
      return true;
    }
    if (ts.isIdentifier(child) && child.text === "undefined") return false;
    return undefined;
  };
  const staticPropertyName = (
    name: ts.PropertyName,
  ): string | undefined => {
    if (
      ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isNoSubstitutionTemplateLiteral(name)
    ) {
      return name.text;
    }
    if (ts.isComputedPropertyName(name)) {
      const expression = name.expression;
      if (
        ts.isStringLiteral(expression) ||
        ts.isNoSubstitutionTemplateLiteral(expression)
      ) {
        return expression.text;
      }
      if (ts.isIdentifier(expression)) return constants.get(expression.text);
    }
    return undefined;
  };
  type ObjectState = Map<string, boolean>;
  const objectStateKey = (state: ObjectState) =>
    JSON.stringify([...state.entries()]);
  const boundedObjectStates = (
    states: ObjectState[],
  ): ObjectState[] | undefined => {
    const unique = new Map<string, ObjectState>();
    for (const state of states) {
      unique.set(objectStateKey(state), state);
      if (unique.size > MAX_CLASS_SCENARIOS) return undefined;
    }
    return [...unique.values()];
  };
  const objectStates = (
    object: ts.ObjectLiteralExpression,
  ): ObjectState[] | undefined => {
    let states: ObjectState[] = [new Map()];
    for (const property of object.properties) {
      if (
        ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)
      ) {
        const key = staticPropertyName(property.name);
        if (!key) return undefined;
        const condition = ts.isPropertyAssignment(property)
          ? property.initializer
          : property.name;
        const truthiness = staticTruthiness(condition);
        const values = truthiness === undefined
          ? [false, true]
          : [truthiness];
        const next = states.flatMap((state) =>
          values.map((value) => {
            const updated = new Map(state);
            updated.set(key, value);
            return updated;
          }),
        );
        const boundedStates = boundedObjectStates(next);
        if (!boundedStates) return undefined;
        states = boundedStates;
        continue;
      }
      if (ts.isSpreadAssignment(property)) {
        if (!ts.isObjectLiteralExpression(property.expression)) {
          return undefined;
        }
        const spreadStates = objectStates(property.expression);
        if (!spreadStates) return undefined;
        const next = states.flatMap((state) =>
          spreadStates.map((spreadState) => {
            const updated = new Map(state);
            for (const [key, value] of spreadState) updated.set(key, value);
            return updated;
          }),
        );
        const boundedStates = boundedObjectStates(next);
        if (!boundedStates) return undefined;
        states = boundedStates;
        continue;
      }
      if (ts.isMethodDeclaration(property)) {
        const key = staticPropertyName(property.name);
        if (!key) return undefined;
        states = states.map((state) => {
          const updated = new Map(state);
          updated.set(key, true);
          return updated;
        });
        continue;
      }
      if (
        ts.isGetAccessorDeclaration(property) ||
        ts.isSetAccessorDeclaration(property)
      ) {
        return undefined;
      }
      return undefined;
    }
    return states;
  };
  const objectClassScenarios = (object: ts.ObjectLiteralExpression) => {
    const states = objectStates(object);
    if (!states) return unknown();
    return bounded(
      states.map((state) =>
        [...state.entries()].flatMap(([key, enabled]) =>
          enabled ? tokens(key) : [],
        ),
      ),
    );
  };
  const scenarios = (child: ts.Node): string[][] => {
    if (ts.isJsxExpression(child)) {
      return child.expression ? scenarios(child.expression) : [[]];
    }
    if (
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child)
    ) {
      return [tokens(child.text)];
    }
    if (ts.isIdentifier(child)) {
      const resolved = constants.get(child.text);
      if (resolved) return [tokens(resolved)];
      return child.text === "undefined" ? [[]] : unknown();
    }
    if (
      ts.isBinaryExpression(child) &&
      child.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return bounded([[], ...scenarios(child.right)]);
    }
    if (ts.isConditionalExpression(child)) {
      return bounded([
        ...scenarios(child.whenTrue),
        ...scenarios(child.whenFalse),
      ]);
    }
    if (ts.isCallExpression(child)) {
      if (
        ts.isIdentifier(child.expression) &&
        child.expression.text === "buttonVariants"
      ) {
        if (child.arguments.length === 0) return [[]];
        if (child.arguments.length > 1) return unknown();
        const options = child.arguments[0];
        if (!ts.isObjectLiteralExpression(options)) return unknown();
        type OptionClasses = {
          class: string[][];
          className: string[][];
        };
        const optionClasses = (
          object: ts.ObjectLiteralExpression,
          initial: OptionClasses,
        ): OptionClasses => {
          let result = initial;
          for (const property of object.properties) {
            if (ts.isSpreadAssignment(property)) {
              result = ts.isObjectLiteralExpression(property.expression)
                ? optionClasses(property.expression, result)
                : { class: unknown(), className: unknown() };
              continue;
            }
            if (
              !ts.isPropertyAssignment(property) &&
              !ts.isShorthandPropertyAssignment(property)
            ) {
              const key = staticPropertyName(property.name);
              if (!key) {
                result = { class: unknown(), className: unknown() };
              } else if (key === "class" || key === "className") {
                result = { ...result, [key]: unknown() };
              }
              continue;
            }
            const key = staticPropertyName(property.name);
            if (!key) {
              result = { class: unknown(), className: unknown() };
              continue;
            }
            if (key !== "class" && key !== "className") continue;
            result = {
              ...result,
              [key]: ts.isPropertyAssignment(property)
                ? scenarios(property.initializer)
                : scenarios(property.name),
            };
          }
          return result;
        };
        const classes = optionClasses(options, {
          class: [[]],
          className: [[]],
        });
        return combine(classes.class, classes.className);
      }
      if (
        !ts.isIdentifier(child.expression) ||
        !["cn", "clsx"].includes(child.expression.text)
      ) {
        return unknown();
      }
      return child.arguments.reduce<string[][]>(
        (result, argument) => combine(result, scenarios(argument)),
        [[]],
      );
    }
    if (ts.isParenthesizedExpression(child)) {
      return scenarios(child.expression);
    }
    if (ts.isArrayLiteralExpression(child)) {
      return child.elements.reduce<string[][]>(
        (result, element) => combine(result, scenarios(element)),
        [[]],
      );
    }
    if (ts.isObjectLiteralExpression(child)) {
      return objectClassScenarios(child);
    }
    if (ts.isTemplateExpression(child)) {
      return child.templateSpans.reduce<string[][]>(
        (result, span) =>
          combine(
            combine(result, scenarios(span.expression)),
            [tokens(span.literal.text)],
          ),
        [tokens(child.head.text)],
      );
    }
    return unknown();
  };
  return scenarios(className.initializer);
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
) {
  const fixedPrefix = axis === "vertical" ? /^(?:h|size)-(.+)$/ : /^(?:w|size)-(.+)$/;
  const minPrefix = axis === "vertical" ? /^min-h-(.+)$/ : /^min-w-(.+)$/;
  const fixed = utility.match(fixedPrefix);
  const min = utility.match(minPrefix);

  if (fixed) state.fixed = axis === "vertical"
    ? numericScaleIsSafe(fixed[1])
    : widthValueIsSafe(fixed[1]);
  if (min) state.min = axis === "vertical"
    ? numericScaleIsSafe(min[1])
    : widthValueIsSafe(min[1]);
}

function safeAtBaseAndTablet(
  classes: string[],
  axis: "vertical" | "horizontal",
) {
  const state: LengthState = { fixed: false, min: false };
  for (const breakpoint of ["base", "sm", "md"]) {
    for (const token of classes) {
      if (token === UNKNOWN_CLASS_SCENARIO) {
        state.fixed = false;
        state.min = false;
        continue;
      }
      const parsed = responsiveParts(token);
      if (parsed?.breakpoint === breakpoint) {
        applyLengthUtility(parsed.utility, axis, state);
      }
    }
    if (!(state.fixed || state.min)) return false;
  }
  return true;
}

function hasDisplayBox(classes: string[]) {
  return classes.some((token) =>
    /^(?:block|flex|grid|inline-block|inline-flex)$/.test(token),
  );
}

function sharedControlHasUnsafeOverride(
  tag: string,
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
  const minimumSized = tag === "MoneyInput" || tag === "Textarea";
  const state = {
    fixedH: !minimumSized,
    minH: minimumSized,
    fixedW: tag !== "MoneyInput",
    minW: minimumSized,
  };
  for (const breakpoint of ["base", "sm", "md"]) {
    for (const token of classes) {
      if (token === UNKNOWN_CLASS_SCENARIO) {
        state.fixedH = false;
        state.minH = false;
        state.fixedW = false;
        state.minW = false;
        continue;
      }
      const parsed = responsiveParts(token);
      if (parsed?.breakpoint !== breakpoint) continue;
      const height = parsed.utility.match(/^h-(.+)$/);
      const width = parsed.utility.match(/^w-(.+)$/);
      const size = parsed.utility.match(/^size-(.+)$/);
      const minHeight = parsed.utility.match(/^min-h-(.+)$/);
      const minWidth = parsed.utility.match(/^min-w-(.+)$/);
      if (height) state.fixedH = numericScaleIsSafe(height[1]);
      if (width && width[1] !== "auto") {
        state.fixedW = widthValueIsSafe(width[1]);
      }
      if (size) {
        state.fixedH = numericScaleIsSafe(size[1]);
        state.fixedW = widthValueIsSafe(size[1]);
      }
      if (minHeight) state.minH = numericScaleIsSafe(minHeight[1]);
      if (minWidth) state.minW = widthValueIsSafe(minWidth[1]);
    }
    if (!(state.fixedH || state.minH) || !(state.fixedW || state.minW)) return true;
  }
  return false;
}

function explicitMobileColumnDeclarations(source: ts.SourceFile) {
  type BindingDeclaration =
    | ts.VariableDeclaration
    | ts.ParameterDeclaration;
  type Binding = {
    declaration: BindingDeclaration;
    name: ts.Identifier;
  };
  const bindings: Binding[] = [];
  const boundIdentifiers = (name: ts.BindingName): ts.Identifier[] => {
    if (ts.isIdentifier(name)) return [name];
    return name.elements.flatMap((element) =>
      ts.isBindingElement(element)
        ? boundIdentifiers(element.name)
        : [],
    );
  };
  const lexicalScope = (node: ts.Node) => {
    let current: ts.Node | undefined = node;
    while (
      current &&
      !ts.isBlock(current) &&
      !ts.isSourceFile(current) &&
      !ts.isCaseBlock(current)
    ) {
      current = current.parent;
    }
    return current ?? source;
  };
  const functionScope = (node: ts.Node) => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isFunctionLike(current)) current = current.parent;
    if (!current) return source;
    return current.body && ts.isBlock(current.body) ? current.body : current;
  };
  const bindingScope = (binding: Binding) => {
    const { declaration } = binding;
    if (ts.isParameter(declaration)) return functionScope(declaration);
    if (
      ts.isVariableDeclarationList(declaration.parent) &&
      !(ts.getCombinedNodeFlags(declaration.parent) & ts.NodeFlags.BlockScoped)
    ) {
      return functionScope(declaration);
    }
    return lexicalScope(declaration);
  };
  const isAncestor = (ancestor: ts.Node, node: ts.Node) =>
    ancestor.getStart(source) <= node.getStart(source) &&
    ancestor.getEnd() >= node.getEnd();
  const resolve = (identifier: ts.Identifier) => {
    const candidates = bindings.filter((binding) =>
      binding.name.text === identifier.text &&
      isAncestor(bindingScope(binding), identifier),
    );
    candidates.sort((a, b) => {
      return bindingScope(a).getWidth(source) - bindingScope(b).getWidth(source);
    });
    const nearest = candidates[0];
    if (!nearest) return undefined;
    const scope = bindingScope(nearest);
    const sameScope = candidates.filter(
      (candidate) => bindingScope(candidate) === scope,
    );
    return sameScope.length === 1 ? nearest : undefined;
  };
  const mobileBindings = new Set<ts.Identifier>();
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node)
    ) {
      for (const name of boundIdentifiers(node.name)) {
        bindings.push({ declaration: node, name });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const associate = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      jsxTagName(node) === "DataTableShell" &&
      attribute(node, "renderMobileRow")
    ) {
      const columns = attribute(node, "columns")?.initializer;
      if (
        columns &&
        ts.isJsxExpression(columns) &&
        columns.expression &&
        ts.isIdentifier(columns.expression)
      ) {
        const binding = resolve(columns.expression);
        if (
          binding &&
          ts.isVariableDeclaration(binding.declaration) &&
          binding.declaration.type?.getText().includes("DataTableColumn")
        ) {
          mobileBindings.add(binding.name);
        }
      }
    }
    ts.forEachChild(node, associate);
  };
  associate(source);
  return mobileBindings;
}

function initializerBindingForNode(
  name: ts.BindingName,
  initializer: ts.Expression | undefined,
  node: ts.Node,
): ts.Identifier | undefined {
  const contains = (container: ts.Node | undefined) =>
    Boolean(
      container &&
      container.getStart() <= node.getStart() &&
      container.getEnd() >= node.getEnd(),
    );
  if (ts.isIdentifier(name)) return contains(initializer) ? name : undefined;

  if (ts.isObjectBindingPattern(name) && initializer) {
    for (const element of name.elements) {
      if (element.initializer && contains(element.initializer)) {
        return initializerBindingForNode(
          element.name,
          element.initializer,
          node,
        );
      }
    }
    if (!ts.isObjectLiteralExpression(initializer)) return undefined;
    const propertyName = (property: ts.PropertyName) => {
      if (
        ts.isIdentifier(property) ||
        ts.isStringLiteral(property) ||
        ts.isNumericLiteral(property) ||
        ts.isNoSubstitutionTemplateLiteral(property)
      ) {
        return property.text;
      }
      return undefined;
    };
    const claimed = new Set(
      name.elements.flatMap((element) => {
        const source = element.propertyName ??
          (ts.isIdentifier(element.name) ? element.name : undefined);
        const resolved = source && propertyName(source);
        return resolved ? [resolved] : [];
      }),
    );
    for (const element of name.elements) {
      if (element.dotDotDotToken) {
        const restProperty = initializer.properties.find((property) => {
          if (
            !ts.isPropertyAssignment(property) &&
            !ts.isShorthandPropertyAssignment(property)
          ) {
            return false;
          }
          const key = propertyName(property.name);
          return Boolean(key && !claimed.has(key) && contains(property));
        });
        if (restProperty) {
          return ts.isIdentifier(element.name) ? element.name : undefined;
        }
        continue;
      }
      const source = element.propertyName ??
        (ts.isIdentifier(element.name) ? element.name : undefined);
      const key = source && propertyName(source);
      if (!key) continue;
      const property = initializer.properties.find((candidate) =>
        (ts.isPropertyAssignment(candidate) ||
          ts.isShorthandPropertyAssignment(candidate)) &&
        propertyName(candidate.name) === key
      );
      if (!property || !contains(property)) continue;
      const value = ts.isPropertyAssignment(property)
        ? property.initializer
        : property.name;
      return initializerBindingForNode(element.name, value, node);
    }
    return undefined;
  }

  if (ts.isArrayBindingPattern(name) && initializer) {
    if (!ts.isArrayLiteralExpression(initializer)) return undefined;
    for (let index = 0; index < name.elements.length; index += 1) {
      const element = name.elements[index];
      if (!ts.isBindingElement(element)) continue;
      if (element.initializer && contains(element.initializer)) {
        return initializerBindingForNode(
          element.name,
          element.initializer,
          node,
        );
      }
      if (element.dotDotDotToken) {
        if (initializer.elements.slice(index).some(contains)) {
          return ts.isIdentifier(element.name) ? element.name : undefined;
        }
        continue;
      }
      const value = initializer.elements[index];
      if (value && contains(value)) {
        return initializerBindingForNode(element.name, value, node);
      }
    }
  }
  return undefined;
}

function isCoveredByExplicitMobileRenderer(
  node: ts.Node,
  bindings: Set<ts.Identifier>,
) {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isVariableDeclaration(current)) {
      const binding = initializerBindingForNode(
        current.name,
        current.initializer,
        node,
      );
      return Boolean(binding && bindings.has(binding));
    }
    current = current.parent;
  }
  return false;
}

function ownHitArea(
  node: ts.JsxOpeningLikeElement,
  classes: string[],
) {
  const tag = jsxTagName(node);
  if (
    classes.includes("fixed") &&
    classes.includes("inset-0")
  ) {
    return true;
  }
  if (node.getText().includes("buttonVariants(")) {
    return !sharedControlHasUnsafeOverride(tag, classes);
  }
  if (GUARANTEED_SHARED_CONTROLS.has(tag)) {
    return !sharedControlHasUnsafeOverride(tag, classes);
  }

  const vertical = safeAtBaseAndTablet(classes, "vertical");
  const horizontal = safeAtBaseAndTablet(classes, "horizontal");
  if (!vertical || !horizontal) return false;

  if (tag === "a" || tag === "Link" || PASSTHROUGH_CONTROL_LINKS.has(tag)) {
    return hasDisplayBox(classes) || node.getText().includes("buttonVariants(");
  }
  return true;
}

function outerHitArea(
  node: ts.JsxOpeningLikeElement,
  constants: Map<string, string>,
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
        return ownHitArea(opening, classTokens(opening, constants));
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
): Candidate[] {
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const constants = stringConstants(source);
  const explicitMobileColumns = explicitMobileColumnDeclarations(source);
  const candidates: Candidate[] = [];

  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      isInteractive(node) &&
      (!onlySharedControlUsage ||
        GUARANTEED_SHARED_CONTROLS.has(jsxTagName(node))) &&
      !isHiddenInput(node, constants) &&
      !NATIVE_PRIMITIVE_IMPLEMENTATIONS.has(file) &&
      !isCoveredByExplicitMobileRenderer(node, explicitMobileColumns) &&
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
      const scenarios = classTokenScenarios(node, constants);
      if (
        !isNestedChoice &&
        scenarios.some((scenario) =>
          !ownHitArea(node, scenario) &&
          !outerHitArea(node, constants),
        )
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
      auditSource(relative(".", file), readFileSync(file, "utf8")),
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
            <MoneyInput value={0} className="min-h-0" />
            <Button className="w-8">narrow shared button</Button>
            <MoneyInput value={0} className={cn(compact && "min-h-0")} />
            <button className={cn("h-11 w-11", compact && "w-8")}>conditionally narrow</button>
            <button className={cn(active && "min-h-11 min-w-11")}>conditional sizing</button>
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
      "MoneyInput",
      "Button",
      "MoneyInput",
      "button",
      "button",
      "SearchableSelect",
    ]);
  });

  test("audits classless links rendered by the default DataTable mobile fallback", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        const columns: DataTableColumn<Row>[] = [{
          key: "project",
          label: "Project",
          render: (row) => <Link href={"/projects/" + row.id}>{row.name}</Link>,
        }];
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual(["Link"]);
  });

  test("associates custom mobile renderers with the exact block-scoped columns binding", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        export function Fixture() {
          let safeTable;
          {
            const columns: DataTableColumn<Row>[] = [{
              key: "safe",
              label: "Safe",
              render: (row) => <Link href={"/safe/" + row.id}>{row.name}</Link>,
            }];
            safeTable = <DataTableShell columns={columns} renderMobileRow={() => <div>safe</div>} />;
          }
          let unsafeTable;
          {
            const columns: DataTableColumn<Row>[] = [{
              key: "unsafe",
              label: "Unsafe",
              render: (row) => <Link href={"/unsafe/" + row.id}>{row.name}</Link>,
            }];
            unsafeTable = <DataTableShell columns={columns} />;
          }
          return <>{safeTable}{unsafeTable}</>;
        }
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual(["Link"]);
  });

  test("resolves inferred and parameter shadowing before applying mobile column metadata", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        const columns: DataTableColumn<Row>[] = [{
          key: "outer",
          label: "Outer",
          render: (row) => <Link href={"/outer/" + row.id}>{row.name}</Link>,
        }];

        function InferredShadow() {
          {
            const columns = [];
            return <DataTableShell columns={columns} renderMobileRow={() => <div>inner</div>} />;
          }
        }

        function InferredLetShadow() {
          {
            let columns = [];
            return <DataTableShell columns={columns} renderMobileRow={() => <div>inner let</div>} />;
          }
        }

        function ParameterShadow(columns: unknown) {
          return <DataTableShell columns={columns} renderMobileRow={() => <div>parameter</div>} />;
        }

        const fallback = <DataTableShell columns={columns} />;
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual(["Link"]);
  });

  test("keeps ambiguous same-scope column bindings in the default mobile audit", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        const columns: DataTableColumn<Row>[] = [{
          key: "ambiguous",
          label: "Ambiguous",
          render: (row) => <Link href={"/ambiguous/" + row.id}>{row.name}</Link>,
        }];
        const columns = [];
        const table = <DataTableShell columns={columns} renderMobileRow={() => <div>custom</div>} />;
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual(["Link"]);
  });

  test("extracts nested destructured binding names before applying mobile column metadata", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        const columns: DataTableColumn<Row>[] = [{
          key: "outer",
          label: "Outer",
          render: (row) => <Link href={"/outer/" + row.id}>{row.name}</Link>,
        }];

        function ObjectParameter({ columns }: Props) {
          return <DataTableShell columns={columns} renderMobileRow={() => <div>object</div>} />;
        }
        function AliasedParameter({ source: columns = [] }: Props) {
          return <DataTableShell columns={columns} renderMobileRow={() => <div>alias</div>} />;
        }
        function NestedParameter({ payload: { columns } }: Props) {
          return <DataTableShell columns={columns} renderMobileRow={() => <div>nested</div>} />;
        }
        function ArrayParameter([columns, ...rest]: Row[][]) {
          return <DataTableShell columns={columns} renderMobileRow={() => <div>{rest.length}</div>} />;
        }
        function VariableBindings(source: Source, values: Row[][]) {
          {
            const { payload: { source: columns = [] } } = source;
            return <DataTableShell columns={columns} renderMobileRow={() => <div>variable</div>} />;
          }
          {
            const [first, ...columns] = values;
            return <DataTableShell columns={columns} renderMobileRow={() => <div>{first.length}</div>} />;
          }
        }

        const fallback = <DataTableShell columns={columns} />;
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual(["Link"]);
  });

  test("exempts only the exact destructured column binding with a mobile renderer", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        const {
          safeColumns,
          source: unsafeColumns,
        }: {
          safeColumns: DataTableColumn<Row>[];
          source: DataTableColumn<Row>[];
        } = {
          safeColumns: [{
            key: "safe-object",
            render: (row) => <Link href={"/safe-object/" + row.id}>{row.name}</Link>,
          }],
          source: [{
            key: "unsafe-object",
            render: (row) => <Link href={"/unsafe-object/" + row.id}>{row.name}</Link>,
          }],
        };
        const [
          safeArrayColumns,
          unsafeArrayColumns,
        ]: [
          DataTableColumn<Row>[],
          DataTableColumn<Row>[],
        ] = [
          [{
            key: "safe-array",
            render: (row) => <Link href={"/safe-array/" + row.id}>{row.name}</Link>,
          }],
          [{
            key: "unsafe-array",
            render: (row) => <Link href={"/unsafe-array/" + row.id}>{row.name}</Link>,
          }],
        ];

        const safeObjectTable = <DataTableShell columns={safeColumns} renderMobileRow={() => <div>safe</div>} />;
        const unsafeObjectTable = <DataTableShell columns={unsafeColumns} />;
        const safeArrayTable = <DataTableShell columns={safeArrayColumns} renderMobileRow={() => <div>safe</div>} />;
        const unsafeArrayTable = <DataTableShell columns={unsafeArrayColumns} />;
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual(["Link", "Link"]);
  });

  test("rejects unsafe conditional overrides in cn object arguments", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        const narrowWidth = "w-8";
        export function Fixture() {
          return <div>
            <Button className={cn("h-11 w-11", { "w-8": compact })} />
            <MoneyInput value={0} className={cn({ "min-h-0": compact })} />
            <Button className={cn("h-11 w-11", { ["h-8"]: compact })} />
            <Button className={cn("h-11 w-11", { [narrowWidth]: compact })} />
          </div>;
        }
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual([
      "Button",
      "MoneyInput",
      "Button",
      "Button",
    ]);
  });

  test("honors static object spread overwrite order", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        export function Fixture() {
          return <div>
            <button className={cn("h-11", { "w-11": true, ...{ "w-11": false } })} />
            <Button className={cn("h-11 w-11", { ...{ "w-8": true } })} />
          </div>;
        }
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual(["button", "Button"]);
  });

  test("fails conservatively instead of truncating conditional object scenarios", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        export function Fixture() {
          return <Button className={cn("h-11 w-11", {
            "w-8": compact,
            alpha,
            beta,
            gamma,
            delta,
            epsilon,
            zeta,
            eta,
          })} />;
        }
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual(["Button"]);
  });

  test("fails closed for unresolved class and cn arguments", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        const unsafe = { "w-8": true };
        export function Fixture() {
          return <div>
            <Button className={cn("h-11 w-11", unsafe)} />
            <Link href="/unknown" className={cn("inline-flex h-11 min-w-11", linkClassName)}>unknown</Link>
            <Button className={cn("h-11 w-11", getClassName())} />
            <Button className={cn("h-11 w-11", { [dynamicKey]: active })} />
            <Button className={cn("h-11 w-11", { ...dynamicClasses })} />
          </div>;
        }
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual([
      "Button",
      "Link",
      "Button",
      "Button",
      "Button",
    ]);
  });

  test("fails closed for unmodeled property, element, template, and arbitrary expressions", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        export function Fixture() {
          return <div>
            <Button className={cn("h-11 w-11", styles[mode])} />
            <Button className={cn("h-11 w-11", styles.compact)} />
            <Button className={cn("h-11 w-11", \`\${styles[mode]}\`)} />
            <Button className={cn("h-11 w-11", tw\`size-\${mode}\`)} />
            <Button className={cn("h-11 w-11", (styles as Record<string, string>)[mode])} />
          </div>;
        }
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual([
      "Button",
      "Button",
      "Button",
      "Button",
      "Button",
    ]);
  });

  test("buttonVariants processes className option overwrites in source order", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        export function Fixture() {
          return <div>
            <Link
              href="/unsafe"
              className={cn(buttonVariants({
                className: "inline-flex h-11 min-w-11",
                ...unsafeOptions,
              }))}
            >
              unsafe
            </Link>
            <button
              type="button"
              className={cn(buttonVariants({
                ...unsafeOptions,
                className: "inline-flex h-11 min-w-11 sm:h-11 sm:min-w-11 md:h-11 md:min-w-11",
              }))}
            >
              safe
            </button>
          </div>;
        }
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual(["Link"]);
  });

  test("buttonVariants models CVA class then className merge and per-key spread overwrites", () => {
    const failures = auditSource(
      "fixture.tsx",
      `
        const safe = "inline-flex h-11 min-w-11 sm:h-11 sm:min-w-11 md:h-11 md:min-w-11";

        export function Fixture() {
          return <div>
            <a
              href="/class-only"
              className={buttonVariants({ class: "h-8 w-8" })}
            >
              unsafe class
            </a>
            <button
              type="button"
              className={buttonVariants({
                class: "h-8 w-8",
                className: safe,
              })}
            >
              safe className wins
            </button>
            <button
              type="button"
              className={buttonVariants({
                className: safe,
                class: "h-8 w-8",
              })}
            >
              safe regardless of object key order
            </button>
            <Link
              href="/class-name-unsafe"
              className={buttonVariants({
                class: safe,
                className: "h-8 w-8",
              })}
            >
              unsafe className
            </Link>
            <button
              type="button"
              className={buttonVariants({
                class: "h-8 w-8",
                ...{ class: safe },
              })}
            >
              safe later class overwrite
            </button>
            <button
              type="button"
              className={buttonVariants({
                className: "h-8 w-8",
                ...{ className: safe },
              })}
            >
              safe later className overwrite
            </button>
            <Link
              href="/spread-after-class"
              className={buttonVariants({
                class: safe,
                ...dynamicOptions,
              })}
            >
              unsafe spread after class
            </Link>
            <Link
              href="/spread-after-class-name"
              className={buttonVariants({
                className: safe,
                ...dynamicOptions,
              })}
            >
              unsafe spread after className
            </Link>
            <Link
              href="/class-after-spread"
              className={buttonVariants({
                ...dynamicOptions,
                class: safe,
              })}
            >
              unsafe unknown className still appends
            </Link>
            <button
              type="button"
              className={buttonVariants({
                ...dynamicOptions,
                className: safe,
              })}
            >
              safe className restores both axes
            </button>
          </div>;
        }
      `,
    );

    expect(failures.map(({ tag }) => tag)).toEqual([
      "a",
      "Link",
      "Link",
      "Link",
      "Link",
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
              <MoneyInput
                value={0}
                className={cn(compact && "min-h-0", "min-h-11")}
              />
              <Button className={cn("h-11 w-11", { "w-8": false })} />
              <Button
                className={cn("h-11 w-11", { "w-8": compact }, "w-11")}
              />
              <MoneyInput
                value={0}
                className={cn({ "min-h-0": compact }, "min-h-11")}
              />
              <Button className={cn({ "w-11": roomy })} />
              <Button className={cn("h-11 w-11", { compact })} />
              <button
                className={cn("h-11", { "w-11": false, ...{ "w-11": true } })}
              />
              <Button
                className={cn(
                  "h-11 w-11",
                  { ...{ "w-8": true }, ...{ "w-11": true } },
                )}
              />
              <Button
                className={cn(
                  "h-11 w-11",
                  { ...{ "w-8": compact } },
                  "w-11",
                )}
              />
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
    expect(inputs).toContain(
      '"min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"',
    );
    expect(selects).toContain('sm: "h-11 px-2.5 pr-8 text-base lg:h-8 lg:text-xs"');
    expect(selects).toContain('default: "h-11 px-3 pr-9 text-base lg:h-10 lg:text-sm"');
    expect(selects).toContain(
      '"flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 lg:min-h-0"',
    );
    expect(quantities).toContain(
      '"grid shrink-0 grid-cols-[44px_minmax(44px,1fr)_44px] overflow-hidden rounded-lg border border-border bg-surface transition-[border-color] duration-150 focus-within:border-primary-600 lg:grid-cols-[32px_minmax(44px,1fr)_32px]"',
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
