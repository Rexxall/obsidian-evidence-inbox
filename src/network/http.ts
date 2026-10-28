import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import { safeNetworkGet, type SafeGetPolicy } from "./safe-get";

export interface HttpTextResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface HttpBinaryResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
}

export interface HttpGateway {
  getText(url: string, timeoutMs?: number, policy?: SafeGetPolicy, signal?: AbortSignal): Promise<HttpTextResponse>;
  getBinary(url: string, timeoutMs?: number, policy?: SafeGetPolicy, signal?: AbortSignal): Promise<HttpBinaryResponse>;
  postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<HttpTextResponse>;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("操作已取消。"));
    };
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    }, timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

function normalizedHeaders(response: RequestUrlResponse): Record<string, string> {
  return Object.fromEntries(
    Object.entries(response.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
}

async function send(params: RequestUrlParam, timeoutMs: number, signal?: AbortSignal): Promise<RequestUrlResponse> {
  return withTimeout(
    requestUrl({ ...params, throw: false }),
    timeoutMs,
    "网络请求超时，请稍后重试。",
    signal
  );
}

export class ObsidianHttpGateway implements HttpGateway {
  async getText(url: string, timeoutMs = 20_000, policy?: SafeGetPolicy, signal?: AbortSignal): Promise<HttpTextResponse> {
    if (policy) {
      const response = await safeNetworkGet(url, {
        policy,
        timeoutMs,
        maxBytes: 8_000_000,
        ...(signal ? { signal } : {})
      });
      return { status: response.status, headers: response.headers, text: new TextDecoder().decode(response.body) };
    }
    const response = await send({ url, method: "GET" }, timeoutMs, signal);
    return { status: response.status, headers: normalizedHeaders(response), text: response.text };
  }

  async getBinary(url: string, timeoutMs = 25_000, policy?: SafeGetPolicy, signal?: AbortSignal): Promise<HttpBinaryResponse> {
    if (policy) {
      const response = await safeNetworkGet(url, {
        policy,
        timeoutMs,
        maxBytes: 15 * 1024 * 1024,
        ...(signal ? { signal } : {})
      });
      return {
        status: response.status,
        headers: response.headers,
        arrayBuffer: response.body.slice().buffer
      };
    }
    const response = await send({ url, method: "GET" }, timeoutMs, signal);
    return {
      status: response.status,
      headers: normalizedHeaders(response),
      arrayBuffer: response.arrayBuffer
    };
  }

  async postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs = 45_000,
    signal?: AbortSignal
  ): Promise<HttpTextResponse> {
    const response = await send({
      url,
      method: "POST",
      contentType: "application/json",
      headers,
      body: JSON.stringify(body)
    }, timeoutMs, signal);
    return { status: response.status, headers: normalizedHeaders(response), text: response.text };
  }
}
