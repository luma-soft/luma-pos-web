import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../messages/en.json";
import viMessages from "../messages/vi.json";

mock.module("@/components/confirm-dialog-provider", () => ({
  ConfirmDialogProvider: ({ children }: { children: React.ReactNode }) => children,
  useConfirmDialog: () => ({
    alert: async () => undefined,
    confirm: async () => true,
  }),
}));

mock.module("next/navigation", () => ({
  usePathname: () => "/projects/project-1",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
    push: () => undefined,
    refresh: () => undefined,
    replace: () => undefined,
  }),
}));

mock.module("@/components/product-catalog-provider", () => ({
  useProductCatalog: () => ({
    products: [],
    snapshot: null,
    status: "synced",
    refresh: async () => undefined,
    search: () => [],
  }),
}));

type MediaModule = typeof import(
  "../src/app/(app)/projects/[id]/project-media-panel"
);

async function loadMediaModule(): Promise<MediaModule | null> {
  return import("../src/app/(app)/projects/[id]/project-media-panel").catch(
    () => null,
  );
}

function renderWithMessages(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="vi"
      messages={viMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {node}
    </NextIntlClientProvider>,
  );
}

function renderWithEnglishMessages(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      messages={enMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {node}
    </NextIntlClientProvider>,
  );
}

const FILES = [
  {
    id: "attachment-acceptance",
    mediaId: "media-acceptance",
    phase: "acceptance" as const,
    caption: "Biên bản tầng một",
    fileName: "nghiem-thu-tang-1.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1_024,
    createdAt: "2026-08-30T08:00:00.000Z",
    documentIds: ["document-acceptance"],
    signedUrl: "https://signed.example/acceptance",
  },
  {
    id: "attachment-survey",
    mediaId: "media-survey",
    phase: "survey" as const,
    caption: null,
    fileName: "khao-sat.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 2_048,
    createdAt: "2026-08-29T08:00:00.000Z",
    documentIds: [],
    signedUrl: "https://signed.example/survey",
  },
];

function descriptor(fileName: string, index = 0) {
  return {
    id: `attachment-${fileName}-${index}`,
    mediaId: `media-${fileName}-${index}`,
    phase: "after_installation" as const,
    caption: null,
    fileName,
    mimeType: fileName.endsWith(".jpg") ? "image/jpeg" : "application/pdf",
    sizeBytes: 128,
    createdAt: "2026-08-31T08:00:00.000Z",
    signedUrl: `https://signed.example/${fileName}`,
  };
}

describe("ProjectMediaPanel", () => {
  test("renders initial project files, the visible CTA, signed actions, and no native picker", async () => {
    const media = await loadMediaModule();
    expect(media?.ProjectMediaPanel).toBeFunction();
    if (!media) return;

    const html = renderWithMessages(
      <media.ProjectMediaPanel projectId="project-1" initialItems={FILES} />,
    );

    expect(html).toContain("Thêm ảnh hoặc tệp");
    expect(html).toContain("Nghiệm thu");
    expect(html).toContain("nghiem-thu-tang-1.pdf");
    expect(html).toContain('aria-label="Mở nghiem-thu-tang-1.pdf"');
    expect(html).toContain('aria-label="Tải xuống nghiem-thu-tang-1.pdf"');
    expect(html).toContain("lucide-file-text");
    expect(html).toContain('alt="khao-sat.jpg"');
    expect(html).not.toMatch(/<select|<datalist|role="combobox"/);
  });

  test("renders grammatical English singular counts", async () => {
    const media = await loadMediaModule();
    expect(media?.ProjectMediaPanel).toBeFunction();
    if (!media) return;

    const html = renderWithEnglishMessages(
      <media.ProjectMediaPanel projectId="project-1" initialItems={[FILES[0]]} />,
    );

    expect(html).toContain("1 photo or file in this view");
  });

  test("renders the controlled picker closed and opened with every approved phase", async () => {
    const media = await loadMediaModule();
    expect(media?.ProjectMediaPhasePicker).toBeFunction();
    if (!media) return;

    const closed = renderWithMessages(
      <media.ProjectMediaPhasePicker
        label="Giai đoạn"
        value="acceptance"
        onChange={() => undefined}
      />,
    );
    const opened = renderWithMessages(
      <media.ProjectMediaPhasePicker
        label="Giai đoạn"
        value="acceptance"
        onChange={() => undefined}
        defaultOpen
      />,
    );

    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('role="listbox"');
    expect(opened).toContain('aria-expanded="true"');
    expect(opened).toContain('role="listbox"');
    for (const label of [
      "Khảo sát",
      "Thi công",
      "Sau lắp đặt",
      "Nghiệm thu",
      "Bàn giao",
      "Khác",
    ]) {
      expect(opened).toContain(label);
    }
    expect(opened).toContain('aria-selected="true"');
  });

  test("moves picker focus with Up/Down, selects with Enter, and closes on Escape/outside", async () => {
    const media = await loadMediaModule();
    expect(media?.nextProjectMediaPickerState).toBeFunction();
    expect(media?.shouldDismissProjectMediaPicker).toBeFunction();
    if (!media) return;

    expect(
      media.nextProjectMediaPickerState(
        { open: false, activeIndex: 1 },
        "ArrowDown",
        6,
      ),
    ).toEqual({ open: true, activeIndex: 2, select: false });
    expect(
      media.nextProjectMediaPickerState(
        { open: true, activeIndex: 0 },
        "ArrowUp",
        6,
      ),
    ).toEqual({ open: true, activeIndex: 5, select: false });
    expect(
      media.nextProjectMediaPickerState(
        { open: true, activeIndex: 4 },
        "Enter",
        6,
      ),
    ).toEqual({ open: false, activeIndex: 4, select: true });
    expect(
      media.nextProjectMediaPickerState(
        { open: true, activeIndex: 4 },
        "Escape",
        6,
      ),
    ).toEqual({ open: false, activeIndex: 4, select: false });
    expect(
      media.nextProjectMediaPickerState(
        { open: true, activeIndex: 4 },
        "Tab",
        6,
      ),
    ).toEqual({ open: false, activeIndex: 4, select: false });

    const inside = {} as Node;
    const outside = {} as Node;
    const root = { contains: (target: Node) => target === inside } as HTMLElement;
    expect(media.shouldDismissProjectMediaPicker(root, inside)).toBe(false);
    expect(media.shouldDismissProjectMediaPicker(root, outside)).toBe(true);
  });

  test("moves Tab focus to the external control adjacent to the picker trigger", async () => {
    const media = await loadMediaModule();
    expect(media?.projectMediaPickerTabTarget).toBeFunction();
    expect(media?.moveProjectMediaPickerTabFocus).toBeFunction();
    if (!media?.projectMediaPickerTabTarget || !media.moveProjectMediaPickerTabFocus) return;

    let focused: HTMLElement | null = null;
    const previous = { focus: () => { focused = previous; } } as HTMLElement;
    const trigger = {} as HTMLElement;
    const activeOption = {} as HTMLElement;
    const next = { focus: () => { focused = next; } } as HTMLElement;
    const pickerRoot = {
      contains: (candidate: Node) => candidate === trigger || candidate === activeOption,
    } as HTMLElement;
    const focusables = [previous, trigger, activeOption, next];

    expect(media.projectMediaPickerTabTarget(
      focusables,
      pickerRoot,
      trigger,
      false,
    )).toBe(next);
    expect(media.projectMediaPickerTabTarget(
      focusables,
      pickerRoot,
      trigger,
      true,
    )).toBe(previous);
    expect(media.moveProjectMediaPickerTabFocus(
      focusables,
      pickerRoot,
      trigger,
      false,
    )).toBe(true);
    expect(focused).toBe(next);
    expect(media.moveProjectMediaPickerTabFocus(
      focusables,
      pickerRoot,
      trigger,
      true,
    )).toBe(true);
    expect(focused).toBe(previous);
  });

  test("applies the Aftercare phase defaults while Finance keeps every phase", async () => {
    const media = await loadMediaModule();
    expect(media?.filterProjectMediaItems).toBeFunction();
    if (!media) return;

    expect(
      media.filterProjectMediaItems(FILES, [
        "after_installation",
        "acceptance",
        "handover",
      ]).map((item) => item.id),
    ).toEqual(["attachment-acceptance"]);
    expect(media.filterProjectMediaItems(FILES).map((item) => item.id)).toEqual([
      "attachment-acceptance",
      "attachment-survey",
    ]);
  });

  test("refreshes signed URLs by attachment identity without losing document links", async () => {
    const media = await loadMediaModule();
    expect(media?.mergeProjectMediaItems).toBeFunction();
    if (!media) return;

    const merged = media.mergeProjectMediaItems(FILES, [
      {
        ...FILES[0],
        documentIds: undefined,
        signedUrl: "https://signed.example/fresh-acceptance",
      },
    ]);

    expect(merged[0]).toMatchObject({
      id: "attachment-acceptance",
      mediaId: "media-acceptance",
      signedUrl: "https://signed.example/fresh-acceptance",
      documentIds: ["document-acceptance"],
    });
  });

  test("falls back to current-tab navigation when a preview popup is blocked", async () => {
    const media = await loadMediaModule();
    expect(media?.navigateProjectMediaPreview).toBeFunction();
    if (!media) return;

    const navigated: string[] = [];
    expect(media.navigateProjectMediaPreview(
      null,
      "https://signed.example/fresh",
      (url: string) => navigated.push(url),
    )).toBe("current");
    expect(navigated).toEqual(["https://signed.example/fresh"]);

    const preview = { location: { href: "about:blank" } };
    expect(media.navigateProjectMediaPreview(
      preview,
      "https://signed.example/preview",
      (url: string) => navigated.push(url),
    )).toBe("preview");
    expect(preview.location.href).toBe("https://signed.example/preview");
  });

  test("rejects list responses that started before a mutation or lost the request race", async () => {
    const media = await loadMediaModule();
    expect(media?.canCommitProjectMediaRequest).toBeFunction();
    if (!media) return;

    expect(media.canCommitProjectMediaRequest({
      aborted: false,
      requestSequence: 3,
      latestRequestSequence: 3,
      mutationRevision: 5,
      currentMutationRevision: 5,
    })).toBe(true);
    expect(media.canCommitProjectMediaRequest({
      aborted: false,
      requestSequence: 2,
      latestRequestSequence: 3,
      mutationRevision: 5,
      currentMutationRevision: 5,
    })).toBe(false);
    expect(media.canCommitProjectMediaRequest({
      aborted: false,
      requestSequence: 3,
      latestRequestSequence: 3,
      mutationRevision: 4,
      currentMutationRevision: 5,
    })).toBe(false);
  });

  test("keeps picker value naming and file-drop keyboard focus visible", async () => {
    const media = await loadMediaModule();
    expect(media?.ProjectMediaPhasePicker).toBeFunction();
    if (!media) return;

    const picker = renderWithMessages(
      <media.ProjectMediaPhasePicker
        label="Giai đoạn"
        value="acceptance"
        onChange={() => undefined}
      />,
    );
    const source = readFileSync(
      "src/app/(app)/projects/[id]/project-media-panel.tsx",
      "utf8",
    );

    expect(picker).toContain("Giai đoạn: ");
    expect(picker).toContain("Nghiệm thu");
    expect(source).toContain('className="hidden"');
    expect(source).toContain("inputRef.current?.click()");
    expect(source).toContain("focus-visible:ring-2");
  });

  test("confirms deletion before issuing the exact project attachment DELETE", async () => {
    const media = await loadMediaModule();
    expect(media?.deleteProjectMediaItem).toBeFunction();
    if (!media) return;

    const requests: Array<{ url: string; method?: string }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method });
      return Response.json({ data: { id: "attachment-acceptance", status: "deleted" } });
    };

    expect(await media.deleteProjectMediaItem({
      projectId: "project-1",
      attachmentId: "attachment-acceptance",
      confirm: async () => false,
      fetcher,
    })).toBe(false);
    expect(requests).toEqual([]);

    expect(await media.deleteProjectMediaItem({
      projectId: "project-1",
      attachmentId: "attachment-acceptance",
      confirm: async () => true,
      fetcher,
    })).toBe(true);
    expect(requests).toEqual([{
      url: "/api/mobile/services/projects/project-1/attachments?attachmentId=attachment-acceptance",
      method: "DELETE",
    }]);
  });

  test("builds a same-origin authorized download URL from attachment identity", async () => {
    const media = await loadMediaModule();
    expect(media?.projectMediaDownloadUrl).toBeFunction();
    if (!media) return;

    expect(media.projectMediaDownloadUrl("project-1", "attachment-1")).toBe(
      "/api/mobile/services/projects/project-1/attachments?attachmentId=attachment-1&download=1",
    );
  });

  test("shows useful loading, empty, error, and accessible ready states", async () => {
    const media = await loadMediaModule();
    expect(media?.ProjectMediaListView).toBeFunction();
    if (!media) return;

    const loading = renderWithMessages(
      <media.ProjectMediaListView state="loading" items={[]} />,
    );
    const empty = renderWithMessages(
      <media.ProjectMediaListView state="ready" items={[]} />,
    );
    const error = renderWithMessages(
      <media.ProjectMediaListView state="error" items={[]} error="Mất kết nối" />,
    );
    const ready = renderWithMessages(
      <media.ProjectMediaListView state="ready" items={FILES} />,
    );

    expect(loading).toContain('aria-label="Đang tải ảnh và hồ sơ"');
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
    expect(empty).toContain("Chưa có ảnh hoặc tệp trong giai đoạn này.");
    expect(error).toContain('role="alert"');
    expect(error).toContain("Mất kết nối");
    expect(ready).toContain('data-media-id="media-acceptance"');
    expect(ready).toContain('data-attachment-id="attachment-acceptance"');

    const source = readFileSync(
      "src/app/(app)/projects/[id]/project-media-panel.tsx",
      "utf8",
    );
    expect(source).toContain('role="progressbar"');
    expect(source).toContain("aria-valuenow={item.progress}");
  });
});

describe("redesigned project dossier integration", () => {
  test("mounts one all-phase panel in Finance and one scoped panel in Aftercare with linked-record upload", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:5432/test";
    const { ProjectRedesignedExperience } = await import(
      "../src/app/(app)/projects/[id]/project-redesigned-experience"
    );
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    const detail = {
      project: {
        id: "project-1",
        name: "HG10 Vũ Yên",
        customerId: null,
        address: null,
        note: null,
        status: "active",
        serviceType: "electrical",
        serviceStage: "active",
        progressPercent: 0,
        startsOn: null,
        targetEndsOn: null,
        siteContactName: null,
        siteContactPhone: null,
        customerName: "Không gian khách",
        orderCount: 0,
        totalValue: "0",
        remaining: "0",
        createdAt: new Date("2026-08-30T08:00:00.000Z"),
      },
      orders: [],
      jobs: [],
      assets: [],
      claims: [],
      materials: [],
      statusLogs: [],
      costEntries: [],
      profitability: {
        revenue: 0,
        materialCost: 0,
        laborCost: 0,
        otherCost: 0,
        totalCost: 0,
        grossProfit: 0,
        marginPercent: 0,
      },
      plannedMaterialCost: 0,
      handoverDocuments: [{
        id: "document-acceptance",
        jobId: null,
        type: "acceptance",
        title: "Nghiệm thu tầng một",
        content: null,
        photoUrls: [],
        signedBy: null,
        signedAt: null,
        status: "draft",
        createdAt: new Date("2026-08-30T08:00:00.000Z"),
      }, {
        id: "document-survey",
        jobId: null,
        type: "survey",
        title: "Khảo sát hiện trạng",
        content: null,
        photoUrls: [],
        signedBy: null,
        signedAt: null,
        status: "draft",
        createdAt: new Date("2026-08-30T08:00:00.000Z"),
      }],
      projectAttachments: FILES,
      maintenancePlans: [],
      dependencies: [],
      coordinationPoints: [],
    };
    const html = renderWithMessages(
      <ProjectRedesignedExperience
        detail={detail as never}
        serviceOptions={{
          customerOptions: [],
          projectOptions: [],
          assigneeOptions: [],
          jobOptions: [],
          assetOptions: [],
          warehouseOptions: [],
        } as never}
      />,
    );

    const aftercare = html.slice(
      html.indexOf('id="project-service-panel-aftercare"'),
      html.indexOf('id="project-service-panel-finance"'),
    );
    const finance = html.slice(html.indexOf('id="project-service-panel-finance"'));
    expect(aftercare).toContain('data-project-media-phases="after_installation,acceptance,handover"');
    expect(aftercare).toContain('data-project-media-upload-signal="enabled"');
    expect(aftercare).toContain("Thêm tệp");
    expect(aftercare.match(/Thêm tệp/g)).toHaveLength(1);
    expect(aftercare).toContain("1 tệp đính kèm");
    expect(finance).toContain('data-project-media-phases="all"');
    expect(finance).toContain('data-project-media-upload-signal="disabled"');
    expect(finance).toContain("nghiem-thu-tang-1.pdf");
  });
});

describe("project media nested modal focus", () => {
  test("wraps focus within the active uploader", async () => {
    const media = await loadMediaModule();
    expect(media?.projectMediaModalFocusTarget).toBeFunction();
    if (!media) return;

    const first = {} as HTMLElement;
    const middle = {} as HTMLElement;
    const last = {} as HTMLElement;
    const outside = {} as HTMLElement;
    const focusables = [first, middle, last];

    expect(media.projectMediaModalFocusTarget(focusables, outside, false)).toBe(first);
    expect(media.projectMediaModalFocusTarget(focusables, first, true)).toBe(last);
    expect(media.projectMediaModalFocusTarget(focusables, last, false)).toBe(first);
    expect(media.projectMediaModalFocusTarget(focusables, middle, false)).toBeNull();
  });
});

describe("project media upload queue", () => {
  test("snapshots metadata on first attempt and preserves it for ambiguous retries", async () => {
    const media = await loadMediaModule();
    expect(media?.snapshotProjectMediaUploadTargets).toBeFunction();
    if (!media) return;

    const pending = [{
      localId: "retry-stable",
      file: new File(["photo"], "stable.jpg", { type: "image/jpeg" }),
    }];
    const firstAttempt = media.snapshotProjectMediaUploadTargets(pending, {
      phase: "acceptance",
      caption: "Bản gốc",
      documentId: "document-acceptance",
    });
    const retry = media.snapshotProjectMediaUploadTargets(firstAttempt, {
      phase: "handover",
      caption: "Đã sửa",
      documentId: "document-handover",
    });

    expect(retry[0].uploadContext).toEqual({
      phase: "acceptance",
      caption: "Bản gốc",
      documentId: "document-acceptance",
    });
  });

  test("uploads one file per request with a bounded concurrency of three", async () => {
    const media = await loadMediaModule();
    expect(media?.uploadProjectMediaFiles).toBeFunction();
    if (!media) return;

    let active = 0;
    let peak = 0;
    const requests: string[] = [];
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const file = form.get("file") as File;
      requests.push(file.name);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active -= 1;
      return Response.json({ ok: true, data: descriptor(file.name, requests.length) });
    };
    const queue = Array.from({ length: 7 }, (_, index) => ({
      localId: `file-${index}`,
      file: new File([`file-${index}`], `file-${index}.jpg`, { type: "image/jpeg" }),
    }));

    const result = await media.uploadProjectMediaFiles({
      projectId: "project-1",
      files: queue,
      phase: "after_installation",
      fetcher,
    });

    expect(peak).toBe(3);
    expect(requests).toHaveLength(7);
    expect(result.every((item) => item.status === "complete")).toBe(true);
  });

  test("announces queued-to-uploading progress before each file completes", async () => {
    const media = await loadMediaModule();
    expect(media?.uploadProjectMediaFiles).toBeFunction();
    if (!media) return;

    const states: Array<{
      status: string;
      progress: number;
      retryable?: boolean;
      httpStatus: number | null;
      errorCategory: string | null;
    }> = [];
    const result = await media.uploadProjectMediaFiles({
      projectId: "project-1",
      files: [{
        localId: "progress-file",
        file: new File(["photo"], "progress.jpg", { type: "image/jpeg" }),
      }],
      phase: "after_installation",
      fetcher: async () => Response.json({
        ok: true,
        data: descriptor("progress.jpg"),
      }),
      onStatus: (_localId, patch) => states.push({
        status: patch.status,
        progress: patch.progress,
        retryable: patch.retryable,
        httpStatus: patch.httpStatus,
        errorCategory: patch.errorCategory,
      }),
    });

    expect(states).toEqual([
      {
        status: "uploading",
        progress: 12,
        retryable: undefined,
        httpStatus: null,
        errorCategory: null,
      },
      {
        status: "uploading",
        progress: 78,
        retryable: undefined,
        httpStatus: 200,
        errorCategory: null,
      },
      {
        status: "complete",
        progress: 100,
        retryable: false,
        httpStatus: 200,
        errorCategory: null,
      },
    ]);
    expect(result[0]).toMatchObject({
      status: "complete",
      retryable: false,
      httpStatus: 200,
      errorCategory: null,
    });
  });

  test("retains failure category and HTTP status while retrying only transient failures", async () => {
    const media = await loadMediaModule();
    expect(media?.uploadProjectMediaFiles).toBeFunction();
    expect(media?.failedProjectMediaUploads).toBeFunction();
    if (!media) return;

    const cases = [
      { localId: "10000000-0000-4000-8000-000000000011", fileName: "network.pdf", status: null, category: "network", retryable: true },
      { localId: "10000000-0000-4000-8000-000000000012", fileName: "invalid-400.pdf", status: 400, category: "validation", retryable: false },
      { localId: "10000000-0000-4000-8000-000000000013", fileName: "unauthorized-401.pdf", status: 401, category: "auth", retryable: false },
      { localId: "10000000-0000-4000-8000-000000000014", fileName: "forbidden-403.pdf", status: 403, category: "auth", retryable: false },
      { localId: "10000000-0000-4000-8000-000000000015", fileName: "missing-404.pdf", status: 404, category: "not_found", retryable: false },
      { localId: "10000000-0000-4000-8000-000000000016", fileName: "timeout-408.pdf", status: 408, category: "timeout", retryable: true },
      { localId: "10000000-0000-4000-8000-000000000017", fileName: "conflict-409.pdf", status: 409, category: "conflict", retryable: false },
      { localId: "10000000-0000-4000-8000-000000000021", fileName: "expired-410.pdf", status: 410, category: "expired", retryable: false },
      { localId: "10000000-0000-4000-8000-000000000018", fileName: "rate-429.pdf", status: 429, category: "rate_limit", retryable: true },
      { localId: "10000000-0000-4000-8000-000000000019", fileName: "server-500.pdf", status: 500, category: "server", retryable: true },
      { localId: "10000000-0000-4000-8000-000000000020", fileName: "invalid-response.pdf", status: 200, category: "invalid_response", retryable: false },
    ] as const;
    const files = cases.map((entry) => ({
      localId: entry.localId,
      file: new File([entry.fileName], entry.fileName, { type: "application/pdf" }),
    }));
    const finalPatches = new Map<string, {
      status: "queued" | "uploading" | "complete" | "failed";
      retryable?: boolean;
      httpStatus?: number | null;
      errorCategory?: string | null;
    }>();
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const file = (init?.body as FormData).get("file") as File;
      const fixture = cases.find((entry) => entry.fileName === file.name);
      if (!fixture || fixture.status === null) throw new TypeError("Failed to fetch");
      if (fixture.category === "invalid_response") {
        return Response.json({ ok: true }, { status: fixture.status });
      }
      return Response.json(
        { error: `fixture.${fixture.status}` },
        { status: fixture.status },
      );
    };

    const results = await media.uploadProjectMediaFiles({
      projectId: "project-1",
      files,
      phase: "acceptance",
      fetcher,
      onStatus: (localId, patch) => {
        finalPatches.set(localId, {
          status: patch.status,
          retryable: patch.retryable,
          httpStatus: patch.httpStatus,
          errorCategory: patch.errorCategory,
        });
      },
    });

    expect(results.map((result) => ({
      localId: result.localId,
      status: result.status,
      retryable: result.retryable,
      httpStatus: result.httpStatus,
      errorCategory: result.errorCategory,
    }))).toEqual(cases.map(({ localId, status: httpStatus, category: errorCategory, retryable }) => ({
      localId,
      status: "failed",
      retryable,
      httpStatus,
      errorCategory,
    })));
    const liveStates = cases.map(({ localId }) => {
      const patch = finalPatches.get(localId);
      if (!patch) throw new Error(`Missing final upload patch for ${localId}`);
      return { localId, ...patch };
    });
    expect(liveStates).toEqual(cases.map(({ localId, status: httpStatus, category: errorCategory, retryable }) => ({
      localId,
      status: "failed",
      retryable,
      httpStatus,
      errorCategory,
    })));
    expect(media.failedProjectMediaUploads(files, results).map((file) => file.localId)).toEqual(
      cases.filter((entry) => entry.retryable).map((entry) => entry.localId),
    );
    expect(media.retryableProjectMediaUploadCount).toBeFunction();
    if (!media.retryableProjectMediaUploadCount) return;
    expect(media.retryableProjectMediaUploadCount(liveStates)).toBe(4);
  });

  test("maps terminal upload categories to useful Vietnamese and English copy", async () => {
    const media = await loadMediaModule();
    expect(media?.projectMediaUploadErrorMessageKey).toBeFunction();
    if (!media?.projectMediaUploadErrorMessageKey) return;

    const categories = [
      "network",
      "timeout",
      "rate_limit",
      "server",
      "validation",
      "conflict",
      "expired",
      "auth",
      "not_found",
      "invalid_response",
    ] as const;
    const keys = categories.map(media.projectMediaUploadErrorMessageKey);

    expect(keys).toEqual([
      "uploadError",
      "uploadError",
      "uploadError",
      "uploadError",
      "uploadValidation",
      "uploadConflict",
      "uploadExpired",
      "uploadAuth",
      "uploadNotFound",
      "uploadInvalidResponse",
    ]);
    expect(keys.slice(4).map((key) => viMessages.projectMedia[key])).toEqual([
      "Tệp hoặc thông tin tải lên không hợp lệ. Hãy kiểm tra rồi chọn lại.",
      "Tệp tải lên xung đột với hồ sơ công trình hiện có. Hãy làm mới rồi chọn lại.",
      "Phiên tải tệp đã hết hạn. Hãy chọn lại tệp để tải lên.",
      "Bạn không có quyền tải tệp này. Hãy đăng nhập lại hoặc liên hệ quản trị viên.",
      "Không tìm thấy công trình hoặc hồ sơ liên kết. Hãy làm mới rồi kiểm tra lại.",
      "Máy chủ trả về phản hồi tải lên không hợp lệ. Hãy kiểm tra dịch vụ trước khi thử lại.",
    ]);
    expect(keys.slice(4).map((key) => enMessages.projectMedia[key])).toEqual([
      "This file or its upload details are invalid. Check them and choose the file again.",
      "This upload conflicts with an existing project file. Refresh and choose the file again.",
      "This upload window has expired. Choose the file again to upload it.",
      "You do not have permission to upload this file. Sign in again or contact an administrator.",
      "The project or linked record was not found. Refresh and check it again.",
      "The server returned an invalid upload response. Check the service before trying again.",
    ]);
  });

  test("preserves partial success and retries only failed files", async () => {
    const media = await loadMediaModule();
    expect(media?.uploadProjectMediaFiles).toBeFunction();
    expect(media?.failedProjectMediaUploads).toBeFunction();
    if (!media) return;

    const attempts = new Map<string, number>();
    const idempotencyKeys = new Map<string, string[]>();
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const file = form.get("file") as File;
      attempts.set(file.name, (attempts.get(file.name) ?? 0) + 1);
      idempotencyKeys.set(file.name, [
        ...(idempotencyKeys.get(file.name) ?? []),
        String(form.get("idempotencyKey")),
      ]);
      if (file.name === "failure.pdf" && attempts.get(file.name) === 1) {
        return Response.json({ error: "errors.serverError" }, { status: 500 });
      }
      return Response.json({ ok: true, data: descriptor(file.name) });
    };
    const files = [
      { localId: "10000000-0000-4000-8000-000000000001", file: new File(["ok"], "success.pdf", { type: "application/pdf" }) },
      { localId: "10000000-0000-4000-8000-000000000002", file: new File(["fail"], "failure.pdf", { type: "application/pdf" }) },
    ];

    const first = await media.uploadProjectMediaFiles({
      projectId: "project-1",
      files,
      phase: "acceptance",
      fetcher,
    });
    expect(first.map((item) => item.status)).toEqual(["complete", "failed"]);

    const retryFiles = media.failedProjectMediaUploads(files, first);
    expect(retryFiles.map((item) => item.localId)).toEqual([
      "10000000-0000-4000-8000-000000000002",
    ]);
    const retried = await media.uploadProjectMediaFiles({
      projectId: "project-1",
      files: retryFiles,
      phase: "acceptance",
      fetcher,
    });

    expect(retried.map((item) => item.status)).toEqual(["complete"]);
    expect(Object.fromEntries(attempts)).toEqual({
      "success.pdf": 1,
      "failure.pdf": 2,
    });
    expect(Object.fromEntries(idempotencyKeys)).toEqual({
      "success.pdf": ["10000000-0000-4000-8000-000000000001"],
      "failure.pdf": [
        "10000000-0000-4000-8000-000000000002",
        "10000000-0000-4000-8000-000000000002",
      ],
    });
  });

  test("links a handover upload by documentId through the project-wide endpoint", async () => {
    const media = await loadMediaModule();
    expect(media?.uploadProjectMediaFiles).toBeFunction();
    if (!media) return;

    const calls: Array<{ url: string; phase: FormDataEntryValue | null; documentId: FormDataEntryValue | null }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      const file = form.get("file") as File;
      calls.push({
        url: String(input),
        phase: form.get("phase"),
        documentId: form.get("documentId"),
      });
      return Response.json({ ok: true, data: descriptor(file.name) });
    };

    await media.uploadProjectMediaFiles({
      projectId: "project-1",
      files: [{
        localId: "handover-file",
        file: new File(["pdf"], "ban-giao.pdf", { type: "application/pdf" }),
      }],
      phase: "handover",
      documentId: "document-handover",
      fetcher,
    });

    expect(calls).toEqual([{
      url: "/api/mobile/services/projects/project-1/attachments",
      phase: "handover",
      documentId: "document-handover",
    }]);
  });

  test("never routes project dossier uploads through per-device attachments", async () => {
    const media = await loadMediaModule();
    expect(media?.uploadProjectMediaFiles).toBeFunction();
    if (!media) return;

    const urls: string[] = [];
    await media.uploadProjectMediaFiles({
      projectId: "project-1",
      files: [{
        localId: "post-install",
        file: new File(["image"], "after.jpg", { type: "image/jpeg" }),
      }],
      phase: "after_installation",
      fetcher: async (input, init) => {
        urls.push(String(input));
        const file = (init?.body as FormData).get("file") as File;
        return Response.json({ ok: true, data: descriptor(file.name) });
      },
    });

    expect(urls).toEqual([
      "/api/mobile/services/projects/project-1/attachments",
    ]);
    expect(urls.some((url) => url.includes("/assets/"))).toBe(false);
  });
});
