import { describe, expect, it, vi } from "vitest";
import { createNoteSaveSession, NOTE_CONFLICT, type NoteChanges } from "@/lib/notepad/saving";
import type { NoteDTO } from "@/lib/notepad/service";
import type { ActionResult } from "@/lib/actionResult";

const note: NoteDTO = { id: "note", title: "Saved", contentHtml: "<p>Saved</p>", excerpt: "Saved", tone: "PLAIN", pinned: false, archived: false, checklist: { done: 0, total: 0 }, updatedAt: "v2" };
function setup(save: (changes: NoteChanges, version: string) => Promise<ActionResult<NoteDTO>>) {
  const onSaved = vi.fn(), onState = vi.fn(), onError = vi.fn();
  return { session: createNoteSaveSession({ version: "v1", save, onSaved, onState, onError }), onSaved, onState, onError };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

describe("note save recovery", () => {
  it("retains rejected edits and prevents closing or archiving until a retry succeeds", async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: "Wait a minute." }).mockResolvedValue({ ok: true, data: note });
    const { session, onState, onError } = setup(save);
    const close = vi.fn(), archive = vi.fn();
    session.queue({ title: "My version", contentHtml: "<p>Keep this</p>" });
    if (await session.flush()) { close(); archive(); }
    expect(close).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
    expect(session.dirty).toBe(true);
    expect(onState).toHaveBeenLastCalledWith("error");
    expect(onError).toHaveBeenCalledWith("Wait a minute.");
    expect(await session.flush()).toBe(true);
    expect(save).toHaveBeenLastCalledWith({ title: "My version", contentHtml: "<p>Keep this</p>" }, "v1");
    expect(session.dirty).toBe(false);
  });

  it.each([false, true])("merges newer pending fields over a rejected save (throws: %s)", async (throws) => {
    const first = deferred<ActionResult<NoteDTO>>();
    const save = vi.fn().mockImplementationOnce(async () => {
      const result = await first.promise;
      if (throws) throw new Error("Disconnected");
      return result;
    }).mockResolvedValue({ ok: true, data: note });
    const { session } = setup(save);
    session.queue({ title: "Old title", contentHtml: "<p>Body</p>" });
    const saving = session.flush();
    session.queue({ title: "New title", tone: "TEAL" });
    first.resolve({ ok: false, error: "Try again." });
    expect(await saving).toBe(false);
    expect(await session.flush()).toBe(true);
    expect(save).toHaveBeenLastCalledWith({ title: "New title", contentHtml: "<p>Body</p>", tone: "TEAL" }, "v1");
  });

  it("waits for autosave and drains later changes serially with the acknowledged version", async () => {
    const first = deferred<ActionResult<NoteDTO>>();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ ok: true, data: { ...note, updatedAt: "v3" } });
    const { session } = setup(save);
    session.queue({ title: "First" });
    const autosave = session.flush();
    session.queue({ title: "Second" });
    const closeFlush = session.flush();
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ ok: true, data: note });
    expect(await Promise.all([autosave, closeFlush])).toEqual([true, true]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ title: "Second" }, "v2");
    expect(session.dirty).toBe(false);
  });

  it("keeps conflicts recoverable and never retries against a stale version", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, error: NOTE_CONFLICT });
    const { session, onState } = setup(save);
    session.queue({ title: "My version" });
    const autosave = session.flush();
    const closeFlush = session.flush();
    expect(await Promise.all([autosave, closeFlush])).toEqual([false, false]);
    session.queue({ contentHtml: "<p>Still mine</p>" });
    expect(await session.flush()).toBe(false);
    expect(onState).toHaveBeenLastCalledWith("conflict");
    expect(save).toHaveBeenCalledTimes(1);
    expect(session.dirty).toBe(true);
  });
});
