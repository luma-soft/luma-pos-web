/**
 * Browser regression for numeric layout. No login, database, or Next server.
 * Run: bun scripts/numeric-layout-regression.mjs
 * Open the printed URL; each iframe exercises real components at its viewport.
 * Source table JSX is extracted at startup, so the fixture cannot drift from it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const paths = {
  stocktake: "src/app/(app)/stocktakes/new/stocktake-form.tsx",
  purchase: "src/app/(app)/purchases/new/purchase-form.tsx",
  order: "src/app/(app)/orders/[id]/edit/order-edit-form.tsx",
  camera: "src/app/(app)/camera-price-list/camera-price-list-client.tsx",
};
const tables = {};
const sources = {};
for (const [name, relativePath] of Object.entries(paths)) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  const start = source.search(/<table(?:\s|>)/);
  const end = source.indexOf("</table>", start);
  if (start < 0 || end < 0) throw new Error(`Missing table in ${relativePath}`);
  tables[name] = source.slice(start, end + "</table>".length);
  sources[name] = source;
}

async function extractElement(relativePath, needles, tagName) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  const file = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let match;
  function visit(node) {
    if (ts.isJsxElement(node) && (!tagName || node.openingElement.tagName.getText(file) === tagName) && needles.every(needle => node.getText(file).includes(needle))) {
      if (!match || node.getWidth(file) < match.getWidth(file)) match = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (!match) throw new Error(`Missing numeric row in ${relativePath}`);
  return match.getText(file);
}
const posAmountRow = await extractElement("src/app/(pos)/pos/pos-client.tsx", ["formatCurrency(eff.price)", "formatCurrency(eff.price * l.quantity)"]);
const portalCartRow = await extractElement("src/app/portal/[token]/portal-client.tsx", ["{p.name}", "formatCurrency(p.price * q)"]);
const installationPath = "src/app/(app)/services/service-installation-batch-create.tsx";
const installationRow = await extractElement(installationPath, ["ProductThumb", "{draft.quantity} {draft.unitName}"]);
tables.cameraDetails = await extractElement(paths.camera, ['["Camera", "cameraPrice"]', "formatCurrency(variant[key])"], "table");
const installationSource = await readFile(path.join(root, installationPath), "utf8");
const thumbnailStart = installationSource.indexOf("function ProductThumb(");
const thumbnailEnd = installationSource.indexOf("\nfunction CatalogMessage(", thumbnailStart);
if (thumbnailStart < 0 || thumbnailEnd < 0) throw new Error("Missing product thumbnail fixture");
const productThumbnail = installationSource.slice(thumbnailStart, thumbnailEnd);
function stringConstant(source, name) {
  const match = source.match(new RegExp(`const ${name} = ("[^"\\n]+")`));
  if (!match) throw new Error(`Missing fixture style constant ${name}`);
  return JSON.parse(match[1]);
}

const entry = `
import React, {useState, useEffect} from "react";
import {createRoot} from "react-dom/client";
import {flushSync} from "react-dom";
import {NextIntlClientProvider, useTranslations} from "next-intl";
import {Check, Trash2, Edit3, Package} from "lucide-react";
import {QuantityInput} from "@/components/ui/quantity-input";
import {MoneyInput} from "@/components/ui/money-input";
import {NumberInput} from "@/components/ui/number-input";
import {Button} from "@/components/ui/button";
import {Select} from "@/components/ui/select";
import {MobileFormLineCard} from "@/components/mobile-ui";
import {cn, formatCurrency, formatNumber} from "@/lib/utils";
import messages from "../messages/vi.json";

const noop = () => {};
const productName = "Bộ phát Wi-Fi ốp trần Ruijie Reyee RG-RAP2200 AC1300 - E";
const variants = [
  {quantity: 0, price: 1, stock: 0},
  {quantity: 1, price: 1, stock: 0},
  {quantity: 99, price: 1980000, stock: 999},
  {quantity: 99, price: 1980000, stock: 99},
  {quantity: 9999, price: 99999999, stock: 0},
  {quantity: 9999999, price: 999999999, stock: 99999999},
];

function Tables({variant, onlyCamera = false}) {
  const t = useTranslations();
  const numeric = variants[variant];
  const cardCount = Number(new URLSearchParams(location.search).get("cards")) || 3;
  const memoryLabels = ["32 GB", "64 GB", "128 GB", "512 GB", "1 TB", "2 TB"].slice(0, cardCount);
  const canEdit = true, openPriceEditor = noop, scrollToPackage = noop, copyMenu = () => <button>Sao chép</button>;
  const filtered = [0,1].map(index => ({id:"camera-" + index,model:productName,installationLocation:"Trong nhà / ngoài trời",variants:memoryLabels.map((label,i) => ({id:String(i),price:numeric.quantity * numeric.price,cameraPrice:numeric.price,cardPrice:numeric.price,installationPrice:numeric.price,materialPrice:numeric.price}))}));
  const item = {...numeric,...filtered[0]};
  const lines = [0, 1].map(index => ({
    productId: "product-" + index, name: productName, sku: "RG-RAP2200(E)",
    baseUnit: "cái", unitName: "cái", units: [], quantity: item.quantity,
    unitCost: item.price, discInput: 0, discMode: "vnd", actualQty: index ? 0 : item.quantity,
    product: {id: "product-" + index, name: productName, sku: "RG-RAP2200(E)", baseUnit: "cái", stock: index ? item.quantity : item.stock, costPrice: item.price},
  }));
  const items = lines.map(line => ({...line, productName, unitPrice: item.price}));
  const setQty = noop, setLines = noop, setItems = noop, patch = noop, patchLineTotal = noop, changeUnit = noop;
  const purchaseLineTotal = line => line.quantity * line.unitCost;
  const numCls = ${JSON.stringify(stringConstant(sources.purchase, "numCls"))};
  const inputCls = ${JSON.stringify(stringConstant(sources.order, "inputCls"))};
  return <>
    ${Object.entries(tables).map(([name, table]) => `{(!onlyCamera || ${name.startsWith("camera")}) && <section data-fixture="${name}" style={{overflowX:"auto",marginBottom:24}}><h2>${name}</h2>${table}</section>}`).join("\n")}
  </>;
}

// Fixtures intentionally use the source component's no-image placeholder branch.
const Image = () => null;
${productThumbnail}
function Installation({variant}) {
  const numeric = variants[variant];
  const draft = {clientDraftId:"draft-1", product:{name:productName,sku:"RG-RAP2200(E)",imageUrls:[]},tracking:"consumable",quantity:numeric.quantity,unitName:"cái"};
  const activeDraft = draft, setActiveDraftId = noop, updateDraft = noop, removeDraft = noop;
  return <div data-fixture="installation-quantity">${installationRow}</div>;
}

function Mobile({variant}) {
  const item = variants[variant];
  const l = {quantity:item.quantity,unitName:"cái",key:"fixture"};
  const eff = {price:item.price}, isCameraQuoteDraft = false, linePriceBookName = null;
  const setEditKey = noop, editKey = null, posUnitSuffix = unit => "/" + unit;
  const p = {name:productName,price:item.price,baseUnit:"cái"}, q = item.quantity, id = "fixture", setQty = noop;
  return <>
    <div data-fixture="mobile-card"><MobileFormLineCard title={productName} subtitle="RG-RAP2200(E) · cái" amount={formatCurrency(item.quantity * item.price)}>
      <QuantityInput value={item.quantity} onChange={noop} className="w-full" touchTargets />
    </MobileFormLineCard></div>
    <div data-fixture="mobile-input-card"><MobileFormLineCard title={productName} subtitle="RG-RAP2200(E) · cái" amount={<MoneyInput value={item.quantity * item.price} onChange={noop} className="w-36 text-right" />}>
      <QuantityInput value={item.quantity} onChange={noop} className="w-full" touchTargets />
    </MobileFormLineCard></div>
    <div data-fixture="pos-mobile-amount">${posAmountRow}</div>
    <div data-fixture="portal-cart">${portalCartRow}</div>
    <Installation variant={variant}/>
    {innerWidth >= 640 && <Tables variant={variant} onlyCamera />}
  </>;
}

// Background tabs throttle animation frames; a macrotask lets input effects settle.
const frame = () => new Promise(resolve => setTimeout(resolve, 30));
const measure = element => {const rect = element.getBoundingClientRect(); return {x: rect.x, width: rect.width};};
function cellOverflow(table) {
  let overflow = 0;
  for (const cell of table.querySelectorAll("tbody td")) {
    const bounds = cell.getBoundingClientRect();
    const inspect = rect => {overflow = Math.max(overflow, bounds.left - rect.left, rect.right - bounds.right)};
    for (const control of cell.querySelectorAll("input:not([type=hidden]),button")) inspect(control.getBoundingClientRect());
    if (cell.cellIndex > 0) {
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!/[0-9]/.test(walker.currentNode.textContent)) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) inspect(rect);
      }
    }
  }
  return Number(overflow.toFixed(2));
}
function snapshot() {
  return [...document.querySelectorAll("[data-fixture]")].map(fixture => {
    const table = fixture.querySelector("table");
    const elements = table ? [...table.querySelector("tbody tr").children]
      : fixture.querySelector("h3") ? [fixture.querySelector("h3"), fixture.querySelector('input[aria-label="Quantity"]')]
      : [...fixture.firstElementChild.children];
    return {name: fixture.dataset.fixture, measurements: elements.map(measure), tableWidth: table?.getBoundingClientRect().width,
      descriptionWidth: fixture.dataset.fixture === "camera" ? elements[2].getBoundingClientRect().width : null,
      overflow: table ? cellOverflow(table) : Math.max(0, fixture.scrollWidth - fixture.clientWidth)};
  });
}
function App() {
  const query = new URLSearchParams(location.search);
  const preview = query.get("preview") === "1";
  const cards = Number(query.get("cards")) || 3;
  const scenarioId = innerWidth + "px-" + cards + "cards";
  const [variant, setVariant] = useState(() => Math.max(0, Math.min(variants.length - 1, Number(query.get("variant")) || 0)));
  const [result, setResult] = useState(null);
  const mobile = query.get("mobile") === "1";
  useEffect(() => {
    if (preview) return;
    let active = true;
    (async () => {
      await document.fonts.ready;
      await frame();
      const baseline = snapshot();
      const checks = [];
      for (let next = 0; next < variants.length; next++) {
        if (!active) return;
        flushSync(() => setVariant(next));
        await frame();
        const current = snapshot();
        current.forEach((after, i) => {
          const before = baseline[i];
          const delta = Math.max(...after.measurements.flatMap((rect, j) => [Math.abs(rect.x-before.measurements[j].x), Math.abs(rect.width-before.measurements[j].width)]));
          checks.push({name:after.name, variant:next, delta:Number(delta.toFixed(2)), overflow:after.overflow,
            descriptionWidth:after.descriptionWidth,
            widths:after.measurements.map(rect => Number(rect.width.toFixed(2))), pass:delta <= 0.5 && after.overflow <= 1 && (after.descriptionWidth == null || after.descriptionWidth >= 199)});
        });
      }
      const output = {id:scenarioId, viewport:innerWidth, cards, pass:checks.every(check => check.pass), checks};
      setResult(output);
      parent.postMessage({numericLayoutResult:output}, location.origin);
      fetch("/result", {method:"POST", body:JSON.stringify(output)});
    })().catch(error => {setResult({error:String(error)}); parent.postMessage({numericLayoutResult:{id:scenarioId,viewport:innerWidth,cards,pass:false,error:String(error)}}, location.origin);});
    return () => {active = false};
  }, []);
  return <>{!preview && <><pre id="result">{result ? JSON.stringify(result, null, 2) : "RUNNING"}</pre>
    <button onClick={() => setVariant(value => (value + 1) % variants.length)}>Đổi số lượng / số tiền</button></>}
    {mobile ? <Mobile variant={variant}/> : <Tables variant={variant} onlyCamera={query.get("onlyCamera") === "1"}/>}</>;
}
createRoot(document.getElementById("root")).render(<NextIntlClientProvider locale="vi" messages={messages}><App/></NextIntlClientProvider>);
`;

const build = await Bun.build({
  entrypoints: [path.join(root, "scripts", "numeric-layout-fixture.tsx")],
  target: "browser",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [{
    name: "numeric-layout-fixture",
    setup(build) {
      build.onResolve({ filter: /numeric-layout-fixture\.tsx$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /numeric-layout-fixture\.tsx$/, namespace: "fixture" }, () => ({ contents: entry, loader: "tsx", resolveDir: path.join(root, "scripts") }));
      // Next navigation is outside this component-only fixture's boundary.
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: "fixture-link", namespace: "fixture" }));
      build.onLoad({ filter: /^fixture-link$/, namespace: "fixture" }, () => ({
        contents: 'import React from "react"; export default function Link(props) {return <a {...props}/>}',
        loader: "tsx", resolveDir: root,
      }));
    },
  }],
});
if (!build.success) throw new AggregateError(build.logs, "Fixture build failed");
const js = await build.outputs[0].text();
const css = (await postcss([tailwindcss({ base: root })]).process(
  await readFile(path.join(root, "src/app/globals.css"), "utf8"),
  { from: path.join(root, "src/app/globals.css") },
)).css;
const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;padding:16px;font-family:Arial,sans-serif}h2{font-size:16px;margin:12px 0}pre{font:12px monospace;white-space:pre-wrap}iframe{display:block;box-sizing:content-box;margin:12px 0;border:1px solid #ddd}button{cursor:pointer}</style>';
const viewportCases = [
  ...[320, 390, 402, 768, 1024, 1280, 1600].map(width => ({ width, cards: 3, onlyCamera: false })),
  ...[4, 6].flatMap(cards => [1024, 1600].map(width => ({ width, cards, onlyCamera: true }))),
];
const results = new Map();
if (process.argv.includes("--build-only")) {
  console.log("Numeric layout fixture bundle and Tailwind CSS compiled successfully.");
  process.exit(0);
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 4319,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/app.js") return new Response(js, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
    if (url.pathname === "/style.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
    if (url.pathname === "/result" && request.method === "POST") {
      const result = await request.json();
      results.set(result.id, result);
      console.log(`${result.pass ? "PASS" : "FAIL"} ${result.id} ${JSON.stringify(result.checks)}`);
      return new Response("ok");
    }
    if (url.pathname === "/results") return Response.json([...results.values()]);
    if (url.pathname === "/frame") return new Response(`<!doctype html><html lang="vi"><head>${head}</head><body><div id="root"></div><script src="/app.js"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
    return new Response(`<!doctype html><html lang="vi"><head>${head}</head><body><h1>Numeric layout regression</h1><p>Real source tables and shared components, numeric values from 0 to 9999999, positive and negative totals; camera tables with 3, 4 and 6 price variants. No database actions.</p><pre id="summary">RUNNING: 0/${viewportCases.length}</pre>${viewportCases.map(({width,cards,onlyCamera}) => `<iframe title="${width}px-${cards}cards" width="${width}" height="900" src="/frame?mobile=${width < 1024 ? 1 : 0}&cards=${cards}&onlyCamera=${onlyCamera ? 1 : 0}"></iframe>`).join("")}<script>const results=new Map();addEventListener('message',event=>{if(event.origin!==location.origin||!event.data.numericLayoutResult)return;const result=event.data.numericLayoutResult;results.set(result.id,result);document.querySelector('#summary').textContent=(results.size===${viewportCases.length}?[...results.values()].every(value=>value.pass)?'PASS':'FAIL':'RUNNING')+' '+results.size+'/${viewportCases.length}\\n'+JSON.stringify([...results.values()],null,2)})</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});
console.log(`Numeric layout regression: ${server.url}`);
