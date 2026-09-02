import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { createMobileAuthMock } from "./helpers/mobile-auth-mock";

afterAll(() => mock.restore());

const created: Array<Record<string, string>> = [];
const updated: Array<Record<string, string>> = [];
const deleted: Array<Record<string, string>> = [];

mock.module("@/lib/mobile/auth", () => createMobileAuthMock({
  requireMobileUser: async () => ({
    ok: true,
    storeId: "store-1",
    userId: "owner-1",
    role: "owner",
    features: { field_services: true },
  }),
  requireMobileManager: async () => ({
    ok: true,
    storeId: "store-1",
    userId: "owner-1",
    role: "owner",
    features: { field_services: true },
  }),
}));

mock.module("@/lib/data/project-notes", () => ({
  getProjectForNotes: async (storeId: string, id: string) =>
    storeId === "store-1" && id === "project-1"
      ? { id: "project-1", serviceType: "camera" }
      : null,
  listProjectNotes: async () => [{ id: "note-1", content: "Ghi chú cũ" }],
  createProjectNote: async (input: Record<string, string>) => {
    created.push(input);
    return { id: "note-2", content: input.content };
  },
  updateProjectNote: async (input: Record<string, string>) => {
    updated.push(input);
    return { id: input.noteId };
  },
  deleteProjectNote: async (input: Record<string, string>) => {
    deleted.push(input);
    return { id: input.noteId };
  },
}));

type CollectionContext = { params: Promise<{ id: string }> };
type ItemContext = { params: Promise<{ id: string; noteId: string }> };

let getNotes: (request: Request, context: CollectionContext) => Promise<Response>;
let postNote: (request: Request, context: CollectionContext) => Promise<Response>;
let patchNote: (request: Request, context: ItemContext) => Promise<Response>;
let deleteNote: (request: Request, context: ItemContext) => Promise<Response>;

beforeAll(async () => {
  const collection = await import(
    "../src/app/api/mobile/projects/[id]/notes/route"
  );
  const item = await import(
    "../src/app/api/mobile/projects/[id]/notes/[noteId]/route"
  );
  getNotes = collection.GET;
  postNote = collection.POST;
  patchNote = item.PATCH;
  deleteNote = item.DELETE;
});

describe("mobile project note CRUD", () => {
  test("does not expose notes from a project outside the tenant", async () => {
    const response = await getNotes(
      new Request("https://luma.test/api/mobile/projects/other-project/notes"),
      { params: Promise.resolve({ id: "other-project" }) },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "errors.notFound" });
  });

  test("rejects notes over the 5000 character limit", async () => {
    const before = created.length;
    const response = await postNote(
      new Request("https://luma.test/api/mobile/projects/project-1/notes", {
        method: "POST",
        body: JSON.stringify({ content: "a".repeat(5001) }),
      }),
      { params: Promise.resolve({ id: "project-1" }) },
    );
    expect(response.status).toBe(400);
    expect(created).toHaveLength(before);
  });
  test("lists project notes for an authorized project", async () => {
    const response = await getNotes(
      new Request("https://luma.test/api/mobile/projects/project-1/notes"),
      { params: Promise.resolve({ id: "project-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: [{ id: "note-1", content: "Ghi chú cũ" }],
    });
  });

  test("creates, edits and deletes a tenant-scoped note", async () => {
    const collectionContext = {
      params: Promise.resolve({ id: "project-1" }),
    };
    const itemContext = {
      params: Promise.resolve({ id: "project-1", noteId: "note-1" }),
    };

    expect((await postNote(new Request(
      "https://luma.test/api/mobile/projects/project-1/notes",
      { method: "POST", body: JSON.stringify({ content: "  Ghi chú mới  " }) },
    ), collectionContext)).status).toBe(200);

    expect((await patchNote(new Request(
      "https://luma.test/api/mobile/projects/project-1/notes/note-1",
      { method: "PATCH", body: JSON.stringify({ content: "Đã sửa" }) },
    ), itemContext)).status).toBe(200);

    expect((await deleteNote(new Request(
      "https://luma.test/api/mobile/projects/project-1/notes/note-1",
      { method: "DELETE" },
    ), itemContext)).status).toBe(200);

    expect(created).toEqual([{
      storeId: "store-1",
      projectId: "project-1",
      actorId: "owner-1",
      content: "Ghi chú mới",
    }]);
    expect(updated).toEqual([{
      storeId: "store-1",
      projectId: "project-1",
      noteId: "note-1",
      content: "Đã sửa",
    }]);
    expect(deleted).toEqual([{
      storeId: "store-1",
      projectId: "project-1",
      noteId: "note-1",
    }]);
  });

  test("rejects blank note content", async () => {
    const response = await postNote(
      new Request("https://luma.test/api/mobile/projects/project-1/notes", {
        method: "POST",
        body: JSON.stringify({ content: "   " }),
      }),
      { params: Promise.resolve({ id: "project-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "errors.invalidData",
    });
  });
});
