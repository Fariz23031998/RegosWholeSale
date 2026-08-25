import { describe, expect, it } from "vitest";
import { extractRegosIntegrationToken } from "./regos-integration-token";

const TOKEN = "031db86123954995958543d9d1123456";

describe("extractRegosIntegrationToken", () => {
  it("extracts token from a full Regos integration URL", () => {
    expect(
      extractRegosIntegrationToken(
        `https://integration.regos.uz/gateway/out/${TOKEN}`,
      ),
    ).toBe(TOKEN);
  });

  it("extracts token when additional path segments follow", () => {
    expect(
      extractRegosIntegrationToken(
        `https://integration.regos.uz/gateway/out/${TOKEN}/v1/item/get`,
      ),
    ).toBe(TOKEN);
  });

  it("returns trimmed raw token unchanged", () => {
    expect(extractRegosIntegrationToken(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it("returns empty string for blank input", () => {
    expect(extractRegosIntegrationToken("   ")).toBe("");
  });
});
