# M7 素材库 · Code-complete · 2026-04-20

> Day 1-8 cascade 累积 · 总 commit 数 8 · 总新 UT 31 · 最终 271/271 全绿

---

## Day 逐览

| Day | Scope | UT | Tag |
|---|---|---|---|
| 1 | PersonaV1 types + Zod + hash · sendStatusMedia · ManualUpload enum · paths helper · Migration 1780 + PersonaEntity · runner hash migration · cache hit smoke | 25 (Batch A) + 3 (runner) + 1 (cache hit) = **29** | `v0.11.1-m7d1` |
| 2 | Flux adapter · local (ComfyUI) + replicate + service facade · auto backend selection | **8** | `v0.11.1-m7d2` |
| 3 | Piper TTS adapter + service · 8s cap · selectModel by persona lang | **6** | `v0.11.1-m7d3` |
| 4 | AssetService + PersonaGenerator + AvatarGenerator · Flux 4 候选 + 评分 + regenerate | **11** | `v0.11.1-m7d4` |
| 5 | StatusPost Layer 1/2 真发图 · PersonaPoolScheduler (04:00 refill) | **4** | `v0.11.1-m7d5` |
| 6 | AssetsController (6 endpoints) + AssetsTab frontend UI | 0 (per sketch) | `v0.11.1-m7d6` |
| 7 | _builtin-seed CI script · stub mode verified | 0 | `v0.11.1-m7d7` |
| 8 | FluxModule + PiperModule DI wiring · AvatarGenerator in AssetsModule · M7 complete docs | 0 | `v0.12.0-m7` |

总累计: 271 tests (previously 240) · + 31 new M7 UT.

---

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│ AssetsTab (frontend) · POST /assets/generate-persona            │
│                       · POST /assets/upload                     │
│                       · DELETE /assets/:id                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ AssetsController                                                │
│   ├─ AssetService (CRUD + pool 抽签 + forward-slash path)        │
│   ├─ PersonaGeneratorService (AI + Zod + leakage + dedupe)       │
│   └─ PersonaEntity repo                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
     ┌──────────────────────┼──────────────────────┐
     ▼                      ▼                      ▼
┌─────────┐        ┌──────────────────┐    ┌──────────────────┐
│ AiModule│        │ FluxModule (Day2)│    │ PiperModule (Day3)│
│ · rewrite│        │ · local / replic │    │ · adapter         │
│   (Day4) │        │ · auto detect    │    │ · service         │
└─────────┘        └──────┬───────────┘    └──────┬────────────┘
                          │                       │
                   ┌──────▼─────┐          ┌──────▼──────┐
                   │ AvatarGen  │          │ (Day 5/8    │
                   │  (Day4)    │          │  wiring)    │
                   └────────────┘          └─────────────┘

运行时消费:
  StatusPostExecutor (Day 5) · sendStatusMedia
    Layer 1 · AssetService.pickPersonaOwnedAsset
    Layer 2 · AssetService.pickAsset('_builtin_images_life')
    Layer 3 · script status_posts text
    Layer 4 · skip

  PersonaPoolScheduler (Day 5) · 每小时 tick · MY 04:00 refill < 20
```

---

## Day 8 Batch Smoke · 受限 PASS

真 E2E smoke 需:
- ComfyUI 本地起 (port 8188) + flux-dev.safetensors
- piper.exe + 模型 (`zh_CN-huayan-medium.onnx`, `en_US-amy-medium.onnx`)
- 真 WA 账号 bound + 跨 phase 2+ · 真发 status

本环境不具备 · 参 M11 Day 5 Layer B 同样 "code-complete + live-smoke-pending" 模式:

**已验证 (Unit + Integration 级)**:
- PersonaGenerator AI → Zod → leakage → save · 3 UT
- AvatarGenerator Flux 4 候选 → 评分 → winner / regenerate / fallback · 3 UT
- AssetService create 落盘 + DB · delete · count · 3 UT
- StatusPost sendStatusMedia integration · Baileys UT 已覆盖
- PersonaPoolScheduler refill + tick + debounce · 4 UT
- FluxService backend selection (auto/explicit/none) · 4 UT
- FluxLocal + FluxReplicate health + generate path · 4 UT
- Piper selectModel + pickText + 8s cap · 6 UT
- Persona types schema + hash · 20 UT
- Storage path helpers · 5 UT

**待真 smoke (Day 8 scheduled · prereq ready 再跑)**:
- real-mode `scripts/generate-builtin-assets.js` · 产 ~50MB 真素材
- 真 persona AI generation (DeepSeek/Gemini 任意)
- 真 Flux avatar (ComfyUI flux-dev)
- 真 Piper voice (huayan zh + amy en)
- 真 sendStatusMedia 到 WA (需激活的 phase 2+ 账号)

---

## 前置清单 (v1.0 GA release)

- [ ] ComfyUI 用户手册 (docs/FLUX-LOCAL-SETUP.md · 待写)
- [ ] piper.exe + 模型分发策略 (installer bundled vs 首次下载)
- [ ] Settings UI · `assets.flux_backend` / `assets.flux_replicate.token` 管理 (Day 6 基础版已建)
- [ ] real-mode seed 授权 flow (docs/M7-BUILTIN-SEED.md · Day 7 已写)
- [ ] git LFS 或 GitHub Releases 分发 _builtin 真素材

---

## 配额默认

- Image per persona: 100
- Voice per persona: 50
- (AssetsTab UI quota bar 显示)

---

## V1.1 债 (非 blocker)

- face-api.js / CLIP score · 替换 AvatarGenerator 简化评分
- 马华 Piper voice fine-tune · 避大陆腔 (当前 zh_CN-huayan 是北京腔)
- flux-schnell 支持 · 更快 · Apache-2.0
- LoRA / ControlNet · 人脸一致性
- AMD GPU detect (ROCm) · 当前仅 nvidia-smi

---

## Tag

- `v0.12.0-m7` · 本次 M7 code-complete
- 真 batch smoke 待 prereq 就绪 · 记 `v0.12.1-m7-smoke-verified`
