import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("./pos-client.tsx",import.meta.url),"utf8");
const start=src.indexOf('onClick={parkActiveDraft}');
const section=src.slice(start-300,start+1900);
test("mobile POS confirmation spans the full row without hiding amount",()=>{
 expect(section).toContain('grid grid-cols-[minmax(0,1fr)_auto] gap-2 lg:flex');
 expect(section).toContain('col-span-2 flex min-h-12 min-w-0 flex-1');
 expect(section).toContain('lg:col-span-1 lg:min-h-0');
 expect(section).toContain('onClick={() => doPrint()}');
 expect(section).toContain('onClick={submitActiveDraft}');
 expect(section).toContain('{primaryActionLabel} · {formatCurrency(total)}');
});
