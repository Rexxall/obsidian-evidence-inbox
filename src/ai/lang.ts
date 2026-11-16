import { explainError, type Lang } from "../vendor/rex-ai-kit/index";

/** The plugin's interface is Chinese only; the shared AI settings and messages follow it. */
export const AI_LANG: Lang = "zh";

/** Which service failed, what it means and the next step. */
export function describeAiError(error: unknown): string {
  return explainError(error, AI_LANG);
}
