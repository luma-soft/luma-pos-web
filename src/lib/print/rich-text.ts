const ALLOWED_TAGS = new Set(["p", "div", "br", "strong", "b", "em", "i", "u", "h3", "ul", "ol", "li", "span", "font"]);
const ALIGNABLE_TAGS = new Set(["p", "div", "h3"]);
const FONT_SIZE_BY_LEGACY_VALUE: Record<string, string> = { "2": "0.85em", "3": "1em", "4": "1.2em" };
const ALLOWED_FONT_SIZES = new Set(Object.values(FONT_SIZE_BY_LEGACY_VALUE));

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
    if (closing) return tag === "br" ? "" : tag === "font" ? "</span>" : `</${tag}>`;
    if (tag === "br") return "<br>";

    if (tag === "font") {
      const legacySize = match[3].match(/\bsize\s*=\s*["']?([234])/i)?.[1] ?? "";
      const fontSize = FONT_SIZE_BY_LEGACY_VALUE[legacySize];
      return fontSize ? `<span style="font-size:${fontSize}">` : "<span>";
    }

    if (tag === "span") {
      const fontSize = match[3].match(/font-size\s*:\s*(0\.85em|1em|1\.2em)/i)?.[1]?.toLowerCase() ?? "";
      return `<span${ALLOWED_FONT_SIZES.has(fontSize) ? ` style="font-size:${fontSize}"` : ""}>`;
    }

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
