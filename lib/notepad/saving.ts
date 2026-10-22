import type { ActionResult } from "@/lib/actionResult";
import type { NoteDTO } from "./service";

export const NOTE_CONFLICT = "This note changed in another tab. Reload it to keep both versions safe.";
export type NoteChanges = Partial<Pick<NoteDTO, "title" | "contentHtml" | "tone" | "pinned">>;
export type NoteSaveState = "saved" | "saving" | "unsaved" | "error" | "conflict";

/** One serial save stream per editor, retaining rejected edits for recovery. */
export function createNoteSaveSession(options: {
  version: string;
  save: (changes: NoteChanges, version: string) => Promise<ActionResult<NoteDTO>>;
  onSaved: (note: NoteDTO) => void;
  onState: (state: NoteSaveState) => void;
  onError: (error: string) => void;
}) {
  let version = options.version;
  let pending: NoteChanges = {};
  let saving: Promise<boolean> | null = null;
  let conflict = false;

  async function flush(): Promise<boolean> {
    if (saving) return (await saving) ? flush() : false;
    if (conflict) return false;
    if (!Object.keys(pending).length) return true;
    const changes = pending;
    pending = {};
    options.onState("saving");
    saving = (async () => {
      try {
        const result = await options.save(changes, version);
        if (!result.ok || !result.data) {
          const error = result.ok ? "Couldn't save. Try again." : result.error;
          pending = { ...changes, ...pending };
          conflict = error === NOTE_CONFLICT;
          options.onState(conflict ? "conflict" : "error");
          options.onError(error);
          return false;
        }
        version = result.data.updatedAt;
        options.onSaved(result.data);
        options.onState(Object.keys(pending).length ? "unsaved" : "saved");
        return true;
      } catch {
        pending = { ...changes, ...pending };
        options.onState("error");
        options.onError("Couldn't save. Try again.");
        return false;
      }
    })();
    const succeeded = await saving;
    saving = null;
    return succeeded ? flush() : false;
  }

  return {
    flush,
    get dirty() { return Boolean(saving) || Object.keys(pending).length > 0; },
    queue(changes: NoteChanges) {
      pending = { ...pending, ...changes };
      options.onState(conflict ? "conflict" : "unsaved");
    },
  };
}
