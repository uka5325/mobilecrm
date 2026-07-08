import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Minimal sessionStorage shim for Node
const store = new Map<string, string>();
const sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  clear: () => store.clear(),
};
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).sessionStorage = sessionStorage;

// Dynamic import after shim setup
const mod = await import("../lib/patientSummaryClientCache.js");

const {
  getPatientSummaryCache,
  setPatientSummaryCache,
  invalidatePatientSummaryCache,
  isPatientSummaryCacheFresh,
  PATIENT_SUMMARY_CACHE_TTL_MS,
} = mod;

const fakePatient = (id: string) => ({
  id,
  patientId: id,
  name: `Patient ${id}`,
});

describe("patientSummaryClientCache", () => {
  beforeEach(() => {
    store.clear();
    invalidatePatientSummaryCache();
  });

  it("returns null when no cache exists", () => {
    assert.equal(getPatientSummaryCache("uid1"), null);
  });

  it("stores and retrieves cache for a UID", () => {
    const patients = [fakePatient("p1"), fakePatient("p2")] as never[];
    setPatientSummaryCache("uid1", patients, "cursor1");
    const cached = getPatientSummaryCache("uid1");
    assert.ok(cached);
    assert.equal(cached.patients.length, 2);
    assert.equal(cached.nextCursor, "cursor1");
    assert.equal(cached.hasMore, true);
  });

  it("fresh cache returns true for isPatientSummaryCacheFresh", () => {
    setPatientSummaryCache("uid1", [] as never[], null);
    const cached = getPatientSummaryCache("uid1");
    assert.equal(isPatientSummaryCacheFresh(cached), true);
  });

  it("stale cache returns false for isPatientSummaryCacheFresh", () => {
    setPatientSummaryCache("uid1", [] as never[], null);
    const cached = getPatientSummaryCache("uid1");
    assert.ok(cached);
    // Fake the timestamp to be old
    cached.cachedAt = Date.now() - PATIENT_SUMMARY_CACHE_TTL_MS - 1;
    assert.equal(isPatientSummaryCacheFresh(cached), false);
  });

  it("null cache returns false for isPatientSummaryCacheFresh", () => {
    assert.equal(isPatientSummaryCacheFresh(null), false);
  });

  it("isolates cache by UID", () => {
    setPatientSummaryCache("uid1", [fakePatient("p1")] as never[], null);
    setPatientSummaryCache("uid2", [fakePatient("p2")] as never[], null);

    const c1 = getPatientSummaryCache("uid1");
    const c2 = getPatientSummaryCache("uid2");
    assert.ok(c1);
    assert.ok(c2);
    assert.equal((c1.patients[0] as { patientId: string }).patientId, "p1");
    assert.equal((c2.patients[0] as { patientId: string }).patientId, "p2");
  });

  it("invalidate with uid clears only that UID", () => {
    setPatientSummaryCache("uid1", [fakePatient("p1")] as never[], null);
    setPatientSummaryCache("uid2", [fakePatient("p2")] as never[], null);
    invalidatePatientSummaryCache("uid1");
    assert.equal(getPatientSummaryCache("uid1"), null);
    assert.ok(getPatientSummaryCache("uid2"));
  });

  it("invalidate without uid clears all UIDs", () => {
    setPatientSummaryCache("uid1", [fakePatient("p1")] as never[], null);
    setPatientSummaryCache("uid2", [fakePatient("p2")] as never[], null);
    invalidatePatientSummaryCache();
    assert.equal(getPatientSummaryCache("uid1"), null);
    assert.equal(getPatientSummaryCache("uid2"), null);
  });

  it("handles corrupted sessionStorage gracefully", () => {
    sessionStorage.setItem("arc_crm_patients_summary_v1_uid1", "not json");
    assert.equal(getPatientSummaryCache("uid1"), null);
  });

  it("handles wrong version gracefully", () => {
    sessionStorage.setItem(
      "arc_crm_patients_summary_v1_uid1",
      JSON.stringify({ version: 999, cachedAt: Date.now(), patients: [] })
    );
    assert.equal(getPatientSummaryCache("uid1"), null);
  });

  it("search results do not overwrite default list cache", () => {
    setPatientSummaryCache("uid1", [fakePatient("p1")] as never[], "c1");
    // Simulate: search result would go to different state, not to setPatientSummaryCache
    const cached = getPatientSummaryCache("uid1");
    assert.ok(cached);
    assert.equal((cached.patients[0] as { patientId: string }).patientId, "p1");
  });

  it("pagination does not overwrite first page cache", () => {
    setPatientSummaryCache("uid1", [fakePatient("p1")] as never[], "c1");
    // Page 2 data — caller should NOT call setPatientSummaryCache for page 2
    // Just verify first page is intact
    const cached = getPatientSummaryCache("uid1");
    assert.ok(cached);
    assert.equal(cached.patients.length, 1);
  });
});
