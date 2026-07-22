import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Routes } from "@/lib/routes";
import { formatDate } from "@/lib/utils";
import { getProjectDetail } from "@/lib/data/projects";
import { PrintToolbar } from "@/components/print/print-toolbar";

export default async function PrintServiceDocumentPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id, documentId } = await params;
  const detail = await getProjectDetail(id);
  const document = detail?.handoverDocuments.find((item) => item.id === documentId);
  if (!detail || !document) notFound();
  const t = await getTranslations();
  return (
    <div className="min-h-screen bg-slate-200 dark:bg-slate-950 print:bg-white">
      <PrintToolbar backHref={Routes.project(id)} baseHref={`/projects/${id}/documents/${documentId}/print`} size="a4" />
      <div className="flex justify-center py-8 print:py-0">
        <article className="min-h-[1000px] w-[794px] bg-white p-12 text-[13px] text-black shadow-lg print:shadow-none">
          <header className="border-b-2 border-black pb-4 text-center">
            <h1 className="text-xl font-bold">{document.title}</h1>
            <p className="mt-1 text-sm">{t(`services.documents.${document.type}` as never)} · {detail.project.name}</p>
            <p className="mt-1 text-xs text-slate-600">{detail.project.customerName ?? t("projects.noCustomer")} · {detail.project.address ?? "—"}</p>
          </header>
          <section className="mt-6 whitespace-pre-wrap leading-6">{document.content || "—"}</section>
          {document.photoUrls.length > 0 && <section className="mt-6"><h2 className="font-bold">{t("services.documents.photoUrls")}</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{document.photoUrls.map((url) => <li key={url} className="break-all">{url}</li>)}</ul></section>}
          <section className="mt-16 flex justify-between text-center">
            <div className="w-1/2"><p>{t("services.documents.customerSign")}</p><div className="h-24" /><p className="font-semibold">{document.signedBy || ""}</p></div>
            <div className="w-1/2"><p>{t("services.documents.companySign")}</p><div className="h-24" /><p className="font-semibold">{document.signedAt ? formatDate(document.signedAt) : ""}</p></div>
          </section>
        </article>
      </div>
    </div>
  );
}
