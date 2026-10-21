import "server-only";

export const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);
export const dateOnly = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : null);
