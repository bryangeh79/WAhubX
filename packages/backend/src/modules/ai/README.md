# AI 模块 · M6

## 架构

```
┌─────────────────────┐
│ ScriptRunnerService │  resolveText() miss
└─────────┬───────────┘
          │ isTextEnabled?
          ▼
┌─────────────────────┐      ┌──────────────────┐
│ AiSettingsService   │      │ AiTextService    │ rewrite()
│  (DB ai_setting)    │      └───────┬──────────┘
└─────────────────────┘              │ pickActiveProvider (DB ai_provider enabled=true)
                                     │ decryptKey
                                     ▼
                           ┌──────────────────┐
                           │ RewriteAdapter   │ 多态分派
                           └───────┬──────────┘
                                   ├─ OpenAICompatAdapter (openai / deepseek / custom_openai_compat)
                                   ├─ GeminiAdapter (NotImplemented @ M6)
                                   └─ ClaudeAdapter (NotImplemented @ M6)
```

## 安全模型 · 密钥存储

- API key 以 AES-256-GCM 加密落 DB `ai_provider.api_key_encrypted`
- 密文格式 `gcm:v1:{iv_hex}:{ciphertext_hex}:{authtag_hex}` · 每次加密随机 IV (12B) · authtag 16B
- 主密钥来自 `MasterKeyProvider` 抽象 · M6 实现: `EnvMasterKeyProvider` 读 env `APP_ENCRYPTION_KEY` (32B hex)
- **M10 计划**: `MachineBoundMasterKeyProvider` 派生自机器指纹, 换机后密钥重新派生 (用户需重填 key — 这是设计)

## 备份与迁移 · gotcha (Admin UI tooltip 同内容)

- **DB 备份含密文** — 备份文件里的 `ai_provider.api_key_encrypted` 无主密钥解不开
- **主密钥必须单独备份** — 生产建议: `APP_ENCRYPTION_KEY` 写进运维密钥保险箱 / password manager, 不与 DB 备份同地
- **.wab 导出不含主密钥** (§B.11) — 换机恢复后用户须重填所有 API key
- **主密钥轮换** = 使所有现有 provider 密文失效, 需全部重录. 没有自动批量重加密 (避免轮换期半成品状态)
- **生产 vs dev** — 开发本机 `APP_ENCRYPTION_KEY` 在 `.env` 里; 生产通过 systemd EnvironmentFile / Windows 服务参数注入

## 降级链 · §B.4

AI 失败任意情况 (key 错 / timeout / 500 / 余额不足 / 未实装 provider) → ScriptRunner 捕获返回 `ok=false`, 降级到 `m4_pool_pick` 原文. **绝不抛错中断剧本.**

rewrite_cache.source 值:
- `m4_pool_pick` — 未命中 AI 或 AI 关闭
- `openai_compat` — OpenAI / DeepSeek / custom_openai_compat adapter 成功
- `gemini` / `claude` — 对应 provider 成功 (M6 未实装, 保留枚举)

## 日志安全

- pino `formatters.log` hook 递归剥除 `apiKey` / `api_key` / `apiKeyEncrypted` / `APP_ENCRYPTION_KEY` / `password` / `license_key` 等字段 (任意深度)
- 单测 `log-redaction.spec.ts` 7 条覆盖常见泄漏面 (req body · nested · authorization header · 密文字段)
- Adapter 层日志只打 `host` + `pathname`, 永不打 body / request headers

## 扩展 · 加 provider

1. 新建 `adapters/<name>.adapter.ts` 实现 `RewriteAdapter`
2. `AiProviderType` enum 加一个值
3. `AiTextService.adapterFor()` switch 加 case
4. 迁移加新 enum 值 (`ALTER TYPE ... ADD VALUE`)

OpenAI-compatible endpoint (Ollama / SiliconFlow / Azure / OpenRouter ...) 不用新 adapter — 选 `custom_openai_compat` type 填自定义 base_url 就完.
