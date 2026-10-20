import "server-only";
// Remove persistence-only fields before a guarded view crosses the server boundary.
// The handler separately rejects these fields to catch DTO regressions.
import { isPrivateViewField } from "./fields";
export function viewDto<T>(value: T): T {
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(viewDto) as T;
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [viewDto(k), viewDto(v)])) as T;
  if (value instanceof Set) return new Set([...value].map(viewDto)) as T;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("A view included a backend-only value.");
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isPrivateViewField(key)).map(([key, item]) => [key, viewDto(item)])) as T;
}
