import { Platform, requestUrl } from "obsidian";
import {
  AiClient,
  ModelCache,
  nodeCliRunner,
  requestUrlTransport,
  type KeyStore,
  type ModelCacheData
} from "../vendor/rex-ai-kit/index";
import { AI_LANG } from "./lang";

export { AI_LANG, describeAiError } from "./lang";

/** Nothing here touches the network; requests start only from Check, Refresh or an import. */
export function createAiClient(keys: KeyStore, cache: ModelCacheData | undefined): AiClient {
  return new AiClient({
    keys,
    transport: requestUrlTransport(requestUrl),
    cache: new ModelCache(cache),
    // Knowledge cards send text only, so Claude Code and Codex on this computer can write them.
    ...(Platform.isDesktopApp ? { cli: nodeCliRunner() } : {}),
    lang: AI_LANG
  });
}
