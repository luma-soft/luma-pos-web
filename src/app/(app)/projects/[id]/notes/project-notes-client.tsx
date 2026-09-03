"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, Loader2, NotebookPen, PencilLine, Plus, RotateCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { RowPreviewModal } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";

export type ProjectNoteView = {
  id: string;
  content: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiEnvelope<T> = { ok: boolean; data?: T; error?: string };

export function ProjectNotesClient({
  projectId,
  initialNotes,
  canManage,
}: {
  projectId: string;
  initialNotes?: ProjectNoteView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const t = useTranslations();
  const { confirm } = useConfirmDialog();
  const [notes, setNotes] = useState(initialNotes);
  const [loading, setLoading] = useState(initialNotes === undefined);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<ProjectNoteView | null | undefined>();
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fetchNotes = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/mobile/projects/${projectId}/notes`, {
      cache: "no-store",
      signal,
    });
    const payload = await response.json().catch(() => null) as ApiEnvelope<ProjectNoteView[]> | null;
    if (!response.ok || !payload?.ok || !Array.isArray(payload.data)) {
      throw new Error(payload?.error ? t(payload.error as never) : "Không thể tải ghi chú. Vui lòng thử lại.");
    }
    return payload.data;
  }, [projectId, t]);

  useEffect(() => {
    if (initialNotes !== undefined) return;
    const controller = new AbortController();
    void fetchNotes(controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setNotes(data);
      setLoadError("");
      setLoading(false);
    }, (cause: unknown) => {
      if (controller.signal.aborted) return;
      setLoadError(describeLoadError(cause));
      setLoading(false);
    });
    return () => controller.abort();
  }, [initialNotes, fetchNotes]);

  async function loadNotes() {
    setLoading(true);
    try {
      setNotes(await fetchNotes());
      setLoadError("");
    } catch (cause) {
      setLoadError(describeLoadError(cause));
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setContent("");
    setError("");
  }

  function openEdit(note: ProjectNoteView) {
    setEditing(note);
    setContent(note.content);
    setError("");
  }

  async function reload() {
    await loadNotes();
    router.refresh();
  }

  async function save() {
    const normalized = content.trim();
    if (!normalized || busy) return;
    setBusy(true);
    setError("");
    try {
      const url = editing
        ? `/api/mobile/projects/${projectId}/notes/${editing.id}`
        : `/api/mobile/projects/${projectId}/notes`;
      const response = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: normalized }),
      });
      const payload = await response.json() as ApiEnvelope<unknown>;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ? t(payload.error as never) : "Không thể lưu ghi chú");
      }
      setEditing(undefined);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể lưu ghi chú");
    } finally {
      setBusy(false);
    }
  }

  async function remove(note: ProjectNoteView) {
    const accepted = await confirm({
      title: "Xóa ghi chú?",
      description: "Ghi chú này sẽ bị xóa khỏi công trình.",
      confirmLabel: "Xóa ghi chú",
      variant: "destructive",
    });
    if (!accepted) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/mobile/projects/${projectId}/notes/${note.id}`,
        { method: "DELETE" },
      );
      const payload = await response.json() as ApiEnvelope<unknown>;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ? t(payload.error as never) : "Không thể xóa ghi chú");
      }
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể xóa ghi chú");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{notes ? `${notes.length} ghi chú` : "Danh sách ghi chú"}</p>
        {canManage && (
          <Button type="button" onClick={openCreate} disabled={busy || loading || notes === undefined}>
            <Plus className="h-4 w-4" />
            Thêm ghi chú
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-er-soft px-3 py-2 text-sm text-er">
          {error}
        </p>
      )}

      {loadError && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-er-soft px-3 py-2 text-sm text-er">
          <p>{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadNotes()} disabled={loading}>
            <RotateCw className="h-4 w-4" />
            Thử lại
          </Button>
        </div>
      )}

      {loading && (
        <p role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải ghi chú…
        </p>
      )}

      {notes?.length === 0 && !loading && !loadError ? (
        <section className="rounded-2xl bg-surface-2 px-5 py-12 text-center">
          <NotebookPen className="mx-auto h-9 w-9 text-primary-600" />
          <h2 className="mt-3 font-semibold">Chưa có ghi chú</h2>
          <p className="mt-1 text-sm text-slate-500">Lưu yêu cầu của khách hoặc việc cần nhớ cho công trình.</p>
        </section>
      ) : notes && notes.length > 0 ? (
        <div className="space-y-3">
          {notes.map((note) => (
            <article key={note.id} className="rounded-2xl border border-border bg-surface px-4 pb-3 pt-4 shadow-sm">
              <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">{note.content}</p>
              <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border-soft pt-3">
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />
                  {[note.authorName, formatNoteTime(note.updatedAt), note.updatedAt !== note.createdAt ? "Đã sửa" : null].filter(Boolean).join(" · ")}
                </p>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="icon" title="Sửa ghi chú" aria-label="Sửa ghi chú" onClick={() => openEdit(note)} disabled={busy}>
                      <PencilLine className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" title="Xóa ghi chú" aria-label="Xóa ghi chú" className="text-er hover:bg-er-soft hover:text-er" onClick={() => void remove(note)} disabled={busy}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </footer>
            </article>
          ))}
        </div>
      ) : null}

      <RowPreviewModal
        open={editing !== undefined}
        onClose={() => {
          if (!busy) setEditing(undefined);
        }}
        title={editing ? "Sửa ghi chú" : "Thêm ghi chú"}
        closeLabel="Đóng"
        size="md"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditing(undefined)} disabled={busy}>Hủy</Button>
            <Button type="button" onClick={() => void save()} disabled={busy || !content.trim()} loading={busy}>
              {editing ? "Lưu thay đổi" : "Thêm ghi chú"}
            </Button>
          </div>
        )}
      >
        <Field label="Nội dung ghi chú" required>
          <Textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={7}
            maxLength={5000}
            autoFocus
            placeholder="Ví dụ: vị trí lắp đặt, yêu cầu của khách…"
          />
        </Field>
        {error && <p role="alert" className="mt-2 text-xs text-er">{error}</p>}
      </RowPreviewModal>
    </>
  );
}

function formatNoteTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function describeLoadError(cause: unknown) {
  return cause instanceof Error && !(cause instanceof TypeError)
    ? cause.message
    : "Không thể tải ghi chú. Vui lòng thử lại.";
}
