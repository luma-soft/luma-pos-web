import { describe, expect, test } from "bun:test";
import { commitSuccessfulMutation } from "@/lib/sync/confirmed-mutation";

describe("confirmed CRUD client publication", () => {
  test.each(["create", "clear", "delete", "rename"])("failed %s preserves current detail, list and draft", async () => {
    const current = { messages: ["keep history"], sessions: ["original title"], draft: "new title" };
    let error: unknown;
    const success = await commitSuccessfulMutation({
      mutate: async () => { throw new Error("write failed"); },
      commit: () => { current.messages = []; current.sessions = []; current.draft = ""; },
      onError: (cause) => { error = cause; },
    });
    expect(success).toBe(false);
    expect(current).toEqual({ messages: ["keep history"], sessions: ["original title"], draft: "new title" });
    expect(error).toBeInstanceOf(Error);
  });

  test("does not publish before success and publishes the committed server result once", async () => {
    let finish!: (result: string) => void;
    const committed: string[] = [];
    const operation = commitSuccessfulMutation({
      mutate: () => new Promise<string>((resolve) => { finish = resolve; }),
      commit: (value) => { committed.push(value); },
      onError: () => { throw new Error("unexpected error"); },
    });
    expect(committed).toEqual([]);
    finish("saved title");
    expect(await operation).toBe(true);
    expect(committed).toEqual(["saved title"]);
  });
});
