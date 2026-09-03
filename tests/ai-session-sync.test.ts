import { describe, expect, test } from "bun:test";
import { waitForAutosavedSessionId } from "@/components/ai-assistant/session-sync";
import { commitSuccessfulMutation } from "@/lib/sync/confirmed-mutation";

describe("AI session mutation after autosave", () => {
  test("clear waits for initial autosave and clears the session it created", async () => {
    let completeSave!: (result: unknown) => void;
    const pendingSave = new Promise<unknown>((resolve) => { completeSave = resolve; });
    const server = new Map<string, string[]>();
    let local = ["original history"];
    const ids: (string | null)[] = [];
    const clear = (async () => {
      const id = await waitForAutosavedSessionId(null, pendingSave);
      return commitSuccessfulMutation({
        mutate: async () => {
          ids.push(id);
          if (id) server.set(id, []);
        },
        commit: () => { local = []; },
        onError: () => { throw new Error("unexpected failure"); },
      });
    })();
    expect(ids).toEqual([]);
    expect(local).toEqual(["original history"]);
    server.set("autosaved-session", ["original history"]);
    completeSave({ session: { id: "autosaved-session" } });
    expect(await clear).toBe(true);
    expect(ids).toEqual(["autosaved-session"]);
    expect(server.get("autosaved-session")).toEqual([]);
    expect(local).toEqual([]);
  });

  test("keeps the selected session ID and tolerates an autosave with no persisted ID", async () => {
    expect(await waitForAutosavedSessionId("selected", Promise.resolve({ session: { id: "other" } }))).toBe("selected");
    expect(await waitForAutosavedSessionId(null, Promise.resolve(undefined))).toBeNull();
    expect(await waitForAutosavedSessionId(null, null)).toBeNull();
    expect(await waitForAutosavedSessionId(null, Promise.resolve({ session: { id: "" } }))).toBeNull();
  });
});
