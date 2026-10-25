import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isAllowedMediaUrl, isAllowedXhsPageUrl } from "../core/security";

export type SafeGetPolicy = "xhs-page" | "xhs-media";

export interface SafeGetResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

function isPublicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0, c = 0] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6(value: string): number[] | null {
  let address = value;
  let ipv4Tail: number[] = [];
  const lastColon = address.lastIndexOf(":");
  if (address.includes(".")) {
    if (lastColon < 0) return null;
    const octets = address.slice(lastColon + 1).split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    ipv4Tail = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    address = `${address.slice(0, lastColon)}:ipv4`;
  }
  if ((address.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw] = address.split("::");
  const parseSide = (part: string | undefined): number[] | null => {
    if (!part) return [];
    const values: number[] = [];
    for (const token of part.split(":").filter(Boolean)) {
      if (token === "ipv4") {
        values.push(...ipv4Tail);
      } else if (/^[0-9a-f]{1,4}$/i.test(token)) {
        values.push(Number.parseInt(token, 16));
      } else {
        return null;
      }
    }
    return values;
  };
  const left = parseSide(leftRaw);
  const right = parseSide(rightRaw);
  if (!left || !right) return null;
  if (address.includes("::")) {
    const missing = 8 - left.length - right.length;
    return missing >= 1 ? [...left, ...Array.from({ length: missing }, () => 0), ...right] : null;
  }
  const combined = [...left, ...right];
  return combined.length === 8 ? combined : null;
}

export function isPublicNetworkAddress(value: string): boolean {
  const address = value.replace(/^\[|\]$/g, "").split("%", 1)[0]?.toLowerCase() ?? "";
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;
  const parts = parseIpv6(address);
  if (!parts) return false;
  const [first = 0, second = 0] = parts;
  const zeroPrefix = parts.slice(0, 7).every((part) => part === 0);
  if (zeroPrefix && (parts[7] === 0 || parts[7] === 1)) return false;
  if (parts.slice(0, 6).every((part) => part === 0)) return false;
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) return false;
  if ((first & 0xfe00) === 0xfc00) return false;
  if ((first & 0xffc0) === 0xfe80 || (first & 0xffc0) === 0xfec0) return false;
  if ((first & 0xff00) === 0xff00) return false;
  if (first === 0x2001 && second === 0x0db8) return false;
  return true;
}

function validatorFor(policy: SafeGetPolicy): (value: string) => boolean {
  return policy === "xhs-page" ? isAllowedXhsPageUrl : isAllowedMediaUrl;
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("操作已取消。"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(new Error("操作已取消。"));
    };
    const cleanup = (): void => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => { cleanup(); resolve(value); },
      (error: unknown) => { cleanup(); reject(error); }
    );
  });
}

async function resolvePublicAddress(hostname: string, signal?: AbortSignal): Promise<ResolvedAddress> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(literal);
  if (literalFamily) {
    if (!isPublicNetworkAddress(literal)) throw new Error("网络目标不是公开地址，已停止请求。");
    return { address: literal, family: literalFamily as 4 | 6 };
  }
  const addresses = await withAbort(lookup(hostname, { all: true, verbatim: true }), signal);
  if (!addresses.length || addresses.some((item) => !isPublicNetworkAddress(item.address))) {
    throw new Error("网络目标解析到非公开地址，已停止请求。");
  }
  const selected = addresses[0]!;
  return { address: selected.address, family: selected.family as 4 | 6 };
}

function normalizedHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) => value === undefined ? [] : [[key.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]])
  );
}

function decodedStream(response: Readable, contentEncoding: string): Readable {
  const encoding = contentEncoding.split(",", 1)[0]?.trim().toLowerCase() ?? "";
  if (!encoding || encoding === "identity") return response;
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(createGunzip());
  if (encoding === "deflate") return response.pipe(createInflate());
  if (encoding === "br") return response.pipe(createBrotliDecompress());
  throw new Error("服务器返回了不受支持的压缩格式。");
}

async function oneRequest(
  url: URL,
  timeoutMs: number,
  maxBytes: number,
  signal?: AbortSignal
): Promise<SafeGetResponse & { location?: string }> {
  const pinned = await resolvePublicAddress(url.hostname, signal);
  if (signal?.aborted) throw new Error("操作已取消。");
  return new Promise((resolve, reject) => {
    let settled = false;
    let activeStream: Readable | null = null;
    let absoluteTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (absoluteTimer) clearTimeout(absoluteTimer);
      signal?.removeEventListener("abort", abortRequest);
    };
    const finishError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const finishSuccess = (value: SafeGetResponse & { location?: string }): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const req = request(url, {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "user-agent": "Mozilla/5.0 EvidenceInbox/0.1 (Obsidian desktop plugin)"
      },
      lookup: ((_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
        callback(null, pinned.address, pinned.family);
      }) as never,
      servername: url.hostname
    }, (response) => {
      const headers = normalizedHeaders(response.headers);
      const status = response.statusCode ?? 0;
      const location = headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.destroy();
        finishSuccess({ status, headers, body: new Uint8Array(), location });
        return;
      }
      let stream: Readable;
      try {
        stream = decodedStream(response, headers["content-encoding"] ?? "");
        activeStream = stream;
      } catch (error) {
        response.destroy();
        finishError(error);
        return;
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      stream.on("data", (chunk: Buffer | Uint8Array) => {
        const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        total += bytes.byteLength;
        if (total > maxBytes) {
          const error = new Error(`响应超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制。`);
          stream.destroy(error);
          response.destroy(error);
          req.destroy(error);
          return;
        }
        chunks.push(bytes);
      });
      stream.on("error", finishError);
      stream.on("end", () => {
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        finishSuccess({ status, headers, body });
      });
    });
    const abortRequest = (): void => {
      const error = new Error("操作已取消。");
      activeStream?.destroy(error);
      req.destroy(error);
      finishError(error);
    };
    absoluteTimer = setTimeout(() => {
      const error = new Error("网络请求超时，请稍后重试。");
      activeStream?.destroy(error);
      req.destroy(error);
      finishError(error);
    }, timeoutMs);
    signal?.addEventListener("abort", abortRequest, { once: true });
    req.on("error", finishError);
    if (signal?.aborted) abortRequest();
    else req.end();
  });
}

export async function safeNetworkGet(
  value: string,
  options: { policy: SafeGetPolicy; timeoutMs: number; maxBytes: number; maxRedirects?: number; signal?: AbortSignal }
): Promise<SafeGetResponse> {
  const validator = validatorFor(options.policy);
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  if (options.signal?.aborted) controller.abort();
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  let current = new URL(value);
  const visited = new Set<string>();
  const maxRedirects = options.maxRedirects ?? 5;
  try {
    for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
      if (!validator(current.href)) throw new Error("重定向目标不在允许的小红书域名或路径中。");
      if (visited.has(current.href)) throw new Error("检测到循环重定向，已停止请求。");
      visited.add(current.href);
      const response = await oneRequest(current, options.timeoutMs, options.maxBytes, controller.signal);
      if (!response.location) return response;
      if (redirect === maxRedirects) throw new Error("重定向次数过多，已停止请求。");
      current = new URL(response.location, current);
    }
    throw new Error("重定向次数过多，已停止请求。");
  } catch (error) {
    if (timedOut) throw new Error("网络请求超时，请稍后重试。");
    if (options.signal?.aborted) throw new Error("操作已取消。");
    throw error;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}
