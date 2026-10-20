import { AsyncLocalStorage } from "node:async_hooks";
import type { revalidatePath as NextRevalidatePath } from "next/cache";

type Invalidation = { path: string; type?: "page" | "layout"; };
const key = Symbol.for("sww.frontend.invalidations");
const globalStore = globalThis as typeof globalThis & { [key]?: AsyncLocalStorage<Invalidation[]>; };
const store = globalStore[key] ??= new AsyncLocalStorage<Invalidation[]>();

export function collectInvalidations<T>(callback: () => Promise<T>) {
  const invalidations: Invalidation[] = [];
  return store.run(invalidations, async () => ({ result: await callback(), invalidations }));
}

export function trackedRevalidation(callback: typeof NextRevalidatePath): typeof NextRevalidatePath {
  return (path, type) => {
    store.getStore()?.push({ path, ...(type ? { type } : {}) });
    if (type) callback(path, type);
    else callback(path);
  };
}
