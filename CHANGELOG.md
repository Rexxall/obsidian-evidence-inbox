# Changelog

## Unreleased

- **AI service, rebuilt on the shared AI layer.** OpenAI, Anthropic and Gemini come first, then DeepSeek, OpenRouter, Qwen, Kimi, Zhipu, SiliconFlow, Ollama, LM Studio, Claude Code and Codex on this computer, and any OpenAI-compatible server. The key is picked from Obsidian's Keychain under a shared name (`openai-api-key` …), so a key saved once serves every plugin. **Check** lists the models the key can use and shows the balance where the provider offers one; the model menu puts recommended picks first. New setups start on OpenAI `gpt-6-luna`. AI stays off until you switch it on.
- Knowledge cards still send only the note's title, author, tags, text and your goal, never images, so Claude Code and Codex on this computer can write them too.
- When a knowledge card fails, the note says which service failed and what to do next: no key, key rejected, out of quota, model missing, timed out, offline, or a reply that could not be read.
- Your settings move over on first start: the service is read from the old address, the model is kept, and the key saved under the old name keeps working. A setup that never had a key starts on the new default.
