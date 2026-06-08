export function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}
