import { savePrintTemplate } from "@/lib/actions/print-templates";
import { requireMobileManager, requireMobileUser } from "@/lib/mobile/auth";
import { mobileAction, mobileGate, mobileOk, readJson, searchParam } from "@/lib/mobile/response";
import { getAllPrintTemplates } from "@/lib/print/template";
import { PRINT_DOC_TYPES, type PrintDocType } from "@/lib/print/template-shared";

export async function GET(request: Request) {
  const gate = await requireMobileUser();
  if (!gate.ok) return mobileGate(gate)!;

  const docTypeParam = searchParam(request, "docType") as PrintDocType | undefined;
  const templates = await getAllPrintTemplates(gate.storeId);
  const filtered = docTypeParam && PRINT_DOC_TYPES.includes(docTypeParam)
    ? templates.filter((template) => template.docType === docTypeParam)
    : templates;
  return mobileOk({ templates: filtered });
}

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });
  return mobileAction(await savePrintTemplate(body));
}
