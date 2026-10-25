import { describe, expect, it } from "vitest";
import {
  isAllowedMediaUrl,
  isAllowedXhsPageUrl,
  safeAiEndpoint,
  sanitizeDiagnostic,
  stripUrlSecrets
} from "../src/core/security";
import { isPublicNetworkAddress } from "../src/network/safe-get";

describe("network and diagnostic safety", () => {
  it("uses exact page-host allowlisting", () => {
    expect(isAllowedXhsPageUrl("https://www.xiaohongshu.com/explore/67abc1230000000012345678")).toBe(true);
    expect(isAllowedXhsPageUrl("https://xhslink.cn/o/code")).toBe(true);
    expect(isAllowedXhsPageUrl("http://xhslink.cn/o/code")).toBe(false);
    expect(isAllowedXhsPageUrl("https://www.xiaohongshu.com/user/profile/abc12345")).toBe(false);
    expect(isAllowedXhsPageUrl(`https://www.xiaohongshu.com/explore/${"a".repeat(200)}`)).toBe(false);
    expect(isAllowedXhsPageUrl("https://xiaohongshu.com.evil.test/explore/abc12345")).toBe(false);
    expect(isAllowedXhsPageUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects private, loopback, link-local, and documentation network targets", () => {
    expect(isPublicNetworkAddress("8.8.8.8")).toBe(true);
    expect(isPublicNetworkAddress("10.0.0.1")).toBe(false);
    expect(isPublicNetworkAddress("127.0.0.1")).toBe(false);
    expect(isPublicNetworkAddress("169.254.169.254")).toBe(false);
    expect(isPublicNetworkAddress("::1")).toBe(false);
    expect(isPublicNetworkAddress("0:0:0:0:0:0:0:1")).toBe(false);
    expect(isPublicNetworkAddress("0:0:0:0:0:ffff:127.0.0.1")).toBe(false);
    expect(isPublicNetworkAddress("::127.0.0.1")).toBe(false);
    expect(isPublicNetworkAddress("fd00::1")).toBe(false);
    expect(isPublicNetworkAddress("2001:db8::1")).toBe(false);
  });

  it("allows only HTTPS Xiaohongshu media hosts", () => {
    expect(isAllowedMediaUrl("https://sns-webpic-qc.xhscdn.com/a.jpg")).toBe(true);
    expect(isAllowedMediaUrl("http://sns-webpic-qc.xhscdn.com/a.jpg")).toBe(false);
    expect(isAllowedMediaUrl("https://xhscdn.com.evil.test/a.jpg")).toBe(false);
    expect(isAllowedMediaUrl("https://127.0.0.1/a.jpg")).toBe(false);
  });

  it("redacts credentials and URL parameters from diagnostics", () => {
    const providerKey = ["sk", "123456789abcdef"].join("-");
    const message = sanitizeDiagnostic(
      `api_key=very-secret ${providerKey} Bearer tokenvalue123 https://example.com/x?token=oops`
    );
    expect(message).not.toContain("very-secret");
    expect(message).not.toContain("123456789abcdef");
    expect(message).not.toContain("tokenvalue123");
    expect(message).not.toContain("token=oops");
    expect(sanitizeDiagnostic("Authorization: Bearer tokenvalue123")).toBe("[redacted]");
    const jsonMessage = sanitizeDiagnostic('{"Authorization":"Bearer abc$def123"}');
    expect(jsonMessage).not.toContain("abc$def123");
    expect(jsonMessage).toContain("[redacted]");
  });

  it("strips share query parameters before durable display", () => {
    expect(stripUrlSecrets("https://xhslink.cn/a/code?xsec_token=secret#fragment"))
      .toBe("https://xhslink.cn/a/code");
  });

  it("requires HTTPS AI endpoints except loopback development", () => {
    expect(safeAiEndpoint("https://api.openai.com/v1")?.href).toBe("https://api.openai.com/v1");
    expect(safeAiEndpoint("http://localhost:11434/v1")?.hostname).toBe("localhost");
    expect(safeAiEndpoint("http://10.0.0.4/v1")).toBeNull();
    expect(safeAiEndpoint("file:///tmp/model")).toBeNull();
  });
});
