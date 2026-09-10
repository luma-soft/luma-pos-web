const ALLOWED_TAGS = new Set(["p", "div", "br", "strong", "b", "em", "i", "u", "h3", "ul", "ol", "li"]);
const ALIGNABLE_TAGS = new Set(["p", "div", "h3"]);

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => decodeCodePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => decodeCodePoint(code, 16));
}

function decodeCodePoint(value: string, radix: number) {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : "";
}

function escapeHtml(value: string) {
  return decodeEntities(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Allow-list sanitizer shared by the settings preview and print renderer. */
export function sanitizePrintRichText(value: string): string {
  if (!value) return "";
  const tokens = value.match(/<[^>]*>|[^<]+|</g) ?? [];
  return tokens.map((token) => {
    if (!token.startsWith("<")) return escapeHtml(token);
    const match = token.match(/^<\s*(\/?)\s*([a-z0-9]+)([^>]*)>$/i);
    if (!match) return "";
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (closing) return tag === "br" ? "" : `</${tag}>`;
    if (tag === "br") return "<br>";

    let align = "";
    if (ALIGNABLE_TAGS.has(tag)) {
      align = match[3].match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1]?.toLowerCase() ?? "";
    }
    return `<${tag}${align ? ` style="text-align:${align}"` : ""}>`;
  }).join("");
}

export function isPrintRichTextEmpty(value: string): boolean {
  return sanitizePrintRichText(value)
    .replace(/<br>|<[^>]+>|&nbsp;/gi, "")
    .trim().length === 0;
}
