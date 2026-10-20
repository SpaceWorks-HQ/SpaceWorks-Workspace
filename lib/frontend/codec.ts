/** A bounded, tagged wire format for server-to-server view and action values. */
export type WireValue =
  | ["null"] | ["undefined"] | ["string", string] | ["number", number] | ["boolean", boolean]
  | ["date", string] | ["bigint", string] | ["array", WireValue[]]
  | ["object", [string, WireValue][]] | ["form", [string, WireValue][]] | ["map", [WireValue, WireValue][]] | ["set", WireValue[]]
  | ["file", { name: string; type: string; data: string; }];
const MAX_DEPTH = 48;
const MAX_ENTRIES = 20_000;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export async function encodeWire(value: unknown, depth = 0): Promise<WireValue> {
  if (depth > MAX_DEPTH) throw new Error("Value is too deeply nested.");
  value = await value;
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number" && Number.isFinite(value)) return ["number", value];
  if (typeof value === "bigint") return ["bigint", String(value)];
  if (value instanceof Date && Number.isFinite(value.getTime())) return ["date", value.toISOString()];
  if (value instanceof File) return ["file", { name: value.name, type: value.type, data: Buffer.from(await value.arrayBuffer()).toString("base64") }];
  if (value instanceof FormData) return ["form", await Promise.all([...value.entries()].map(async ([key, item]) => [key, await encodeWire(item, depth + 1)] as [string, WireValue]))];
  if (Array.isArray(value)) {
    if (value.length > MAX_ENTRIES) throw new Error("Too many entries.");
    return ["array", await Promise.all(value.map((item) => encodeWire(item, depth + 1)))];
  }
  if (value instanceof Map) return ["map", await Promise.all([...value].map(async ([key, item]) => [await encodeWire(key, depth + 1), await encodeWire(item, depth + 1)] as [WireValue, WireValue]))];
  if (value instanceof Set) return ["set", await Promise.all([...value].map((item) => encodeWire(item, depth + 1)))];
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const entries = Object.entries(value);
    if (entries.length > MAX_ENTRIES || entries.some(([key]) => FORBIDDEN_KEYS.has(key))) throw new Error("Invalid object.");
    return ["object", await Promise.all(entries.map(async ([key, item]) => [key, await encodeWire(item, depth + 1)] as [string, WireValue]))];
  }
  throw new Error("Unsupported transport value.");
}

export function decodeWire(input: unknown, depth = 0, budget = { entries: MAX_ENTRIES }): unknown {
  if (depth > MAX_DEPTH || --budget.entries < 0 || !Array.isArray(input)) throw new Error("Invalid transport value.");
  const [tag, value] = input;
  const child = (item: unknown) => decodeWire(item, depth + 1, budget);
  if (input.length === 1 && tag === "null") return null;
  if (input.length === 1 && tag === "undefined") return undefined;
  if (input.length !== 2) throw new Error("Invalid transport value.");
  if (tag === "string" && typeof value === "string") return value;
  if (tag === "boolean" && typeof value === "boolean") return value;
  if (tag === "number" && typeof value === "number" && Number.isFinite(value)) return value;
  if (tag === "bigint" && typeof value === "string" && /^-?\d{1,100}$/.test(value)) return BigInt(value);
  if (tag === "date" && typeof value === "string" && new Date(value).toISOString() === value) return new Date(value);
  if ((tag === "array" || tag === "set") && Array.isArray(value)) {
    const items = value.map(child);
    return tag === "set" ? new Set(items) : items;
  }
  if ((tag === "object" || tag === "map" || tag === "form") && Array.isArray(value)) {
    const entries = value.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) throw new Error("Invalid entry.");
      if (tag === "map") return [child(entry[0]), child(entry[1])] as const;
      if (typeof entry[0] !== "string" || FORBIDDEN_KEYS.has(entry[0])) throw new Error("Invalid key.");
      return [entry[0], child(entry[1])] as const;
    });
    if (tag === "map") return new Map(entries);
    if (tag === "form") {
      const form = new FormData();
      for (const [key, item] of entries) {
        if (typeof key !== "string" || !(typeof item === "string" || item instanceof File)) throw new Error("Invalid form entry.");
        form.append(key, item);
      }
      return form;
    }
    return Object.fromEntries(entries);
  }
  if (tag === "file" && value && typeof value === "object") {
    const file = value as Record<string, unknown>;
    if (typeof file.name !== "string" || file.name.length > 255 || typeof file.type !== "string" || file.type.length > 100 || typeof file.data !== "string" || file.data.length > 36_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data) || Buffer.from(file.data, "base64").toString("base64") !== file.data) throw new Error("Invalid file.");
    return new File([Buffer.from(file.data, "base64")], file.name, { type: file.type });
  }
  throw new Error("Invalid transport value.");
}
