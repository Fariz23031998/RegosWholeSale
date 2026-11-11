import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const localStore: Record<string, string> = {};
const sessionStore: Record<string, string> = {};

function makeStorage(store: Record<string, string>) {
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(store)) delete store[key];
    }),
  };
}

vi.stubGlobal("localStorage", makeStorage(localStore));
vi.stubGlobal("sessionStorage", makeStorage(sessionStore));

import {
  clearPartnerToken,
  formatAmount,
  isPartnerTokenExpired,
  partnerTokenExpiresAtMs,
  partnerTokenKey,
  readPartnerToken,
  writePartnerToken,
} from "./partner-format";

function fakeJwt(expSeconds: number): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ exp: expSeconds, typ: "partner_telegram" }));
  return `${header}.${payload}.sig`;
}

describe("formatAmount", () => {
  it("groups thousands and keeps only meaningful decimals", () => {
    expect(formatAmount(23456.23)).toBe("23 456.23");
    expect(formatAmount(23456)).toBe("23 456");
    expect(formatAmount(23456.0)).toBe("23 456");
    expect(formatAmount(23456.5)).toBe("23 456.5");
    expect(formatAmount(23456.346)).toBe("23 456.35");
  });
});

describe("partner portal token persistence", () => {
  beforeEach(() => {
    for (const key of Object.keys(localStore)) delete localStore[key];
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  afterEach(() => {
    for (const key of Object.keys(localStore)) delete localStore[key];
    for (const key of Object.keys(sessionStore)) delete sessionStore[key];
  });

  it("stores tokens in localStorage so sessions survive browser reopen", () => {
    const token = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    writePartnerToken("bot-key", token);
    expect(localStore[partnerTokenKey("bot-key")]).toBe(token);
    expect(readPartnerToken("bot-key")).toBe(token);
  });

  it("migrates a sessionStorage token into localStorage", () => {
    const token = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    sessionStore[partnerTokenKey("bot-key")] = token;
    expect(readPartnerToken("bot-key")).toBe(token);
    expect(localStore[partnerTokenKey("bot-key")]).toBe(token);
    expect(sessionStore[partnerTokenKey("bot-key")]).toBeUndefined();
  });

  it("clears expired tokens using the JWT exp claim", () => {
    const nowMs = Date.UTC(2026, 10, 11, 12, 0, 0);
    const expired = fakeJwt(Math.floor(nowMs / 1000) - 60);
    writePartnerToken("bot-key", expired);
    expect(isPartnerTokenExpired(expired, nowMs)).toBe(true);
    expect(partnerTokenExpiresAtMs(expired)).toBe(nowMs - 60_000);
    expect(readPartnerToken("bot-key", nowMs)).toBeNull();
    expect(localStore[partnerTokenKey("bot-key")]).toBeUndefined();
  });

  it("keeps tokens that have not reached JWT exp yet", () => {
    const nowMs = Date.UTC(2026, 10, 11, 12, 0, 0);
    const valid = fakeJwt(Math.floor(nowMs / 1000) + 24 * 3600);
    writePartnerToken("bot-key", valid);
    expect(isPartnerTokenExpired(valid, nowMs)).toBe(false);
    expect(readPartnerToken("bot-key", nowMs)).toBe(valid);
  });

  it("clears both storages on logout", () => {
    const token = fakeJwt(Math.floor(Date.now() / 1000) + 3600);
    localStore[partnerTokenKey("bot-key")] = token;
    sessionStore[partnerTokenKey("bot-key")] = token;
    clearPartnerToken("bot-key");
    expect(localStore[partnerTokenKey("bot-key")]).toBeUndefined();
    expect(sessionStore[partnerTokenKey("bot-key")]).toBeUndefined();
  });
});
