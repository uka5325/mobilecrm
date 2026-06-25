// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toSerializable(val: any): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "object" && typeof val.toMillis === "function") return val.toMillis();
  if (Array.isArray(val)) return val.map(toSerializable);
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) out[k] = toSerializable(v);
    return out;
  }
  return val;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function docToObj(d: any): Record<string, unknown> {
  return toSerializable({ id: d.id, ...d.data() }) as Record<string, unknown>;
}

export function cleanText(v: unknown): string {
  return String(v ?? "").trim();
}
