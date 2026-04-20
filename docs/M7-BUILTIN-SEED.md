# M7 _builtin 素材 seed 生成流程

> 起 2026-04-20 · M7 Day 7 · cascade [12]
> 用途: 为 installer 预置的 `data/assets/_builtin/` 池生成种子素材

---

## 什么是 _builtin

运行时 StatusPostExecutor 的 4 层降级链:

1. **Layer 1** · persona 专属 (用户 AI 生成 · asset.persona_id 匹配)
2. **Layer 2** · `_builtin_*` 通用池 · **← 本文档覆盖**
3. **Layer 3** · script_pack 纯文本 status_posts
4. **Layer 4** · skip

Layer 2 是用户 persona 池空时的兜底 · 确保首日就能发 status 图. 必须由 installer 预置.

---

## 生成方式

### Stub mode (dev / CI smoke)

生成占位 PNG/OGG 文件 · 不是真素材 · 仅验证 installer pipeline:

```bash
node scripts/generate-builtin-assets.js \
  --mode stub \
  --out /tmp/builtin-test \
  --personas 5 \
  --images 10 \
  --voices 10
```

产出约 12MB · 结构:

```
<out>/
  image/
    _builtin_images_life/
    _builtin_images_food/
    _builtin_images_cafe/
  voice/
    _builtin_voices_greeting/
    _builtin_voices_casual_laugh/
    _builtin_voices_confirmation/
```

### Real mode (release build)

调真 Flux + Piper · 产出真 50MB 左右生产素材:

```bash
# 前置
# 1. ComfyUI 在 127.0.0.1:8188 起 · 载入 flux-dev.safetensors
# 2. piper.exe + zh_CN-huayan-medium.onnx + en_US-amy-medium.onnx 就位
# 3. WAhubX backend 跑 · AI providers 配好

node scripts/generate-builtin-assets.js \
  --mode real \
  --out "$(pwd)/data/assets/_builtin" \
  --personas 5 \
  --images 10 \
  --voices 10
```

**real mode 当前未实装** · 脚本会 exit 20 并提示. Day 8 batch smoke 时接 FluxService / PiperService.

---

## 大小约束

| 规模 | 行动 |
|---|---|
| ≤ 50 MB | 直接 commit (git 原生 OK) |
| 50-100 MB | 监控 · 考虑 git LFS |
| > 100 MB | **HALT** · 必须 GitHub Releases 外挂 · 不进 git repo |

脚本 exit 10 = 超 100MB 上限.

详见 `staging/v1.0-release-checklist.draft.md` §2.

---

## .gitignore 状态

`data/assets/*` 已 ignored. 真 seed 产出不会意外入库. 要分发时:

- git LFS: `git lfs track "data/assets/_builtin/**"` · push 到 LFS
- GitHub Releases: tar.gz 打包 · `gh release create` 附件上传 · installer 脚本下载

---

## Installer 打包路径

见 `installer/build.bat` Step 7c + `wahubx-setup.iss`:

```
repo_root/data/assets/_builtin/
  → build.bat xcopy to staging/data/assets/_builtin/
  → wahubx-setup.iss [Files] 段 → {app}/seeds/_builtin
  → {app}/scripts/init-db.bat 首次运行 copy 到 {app}/data/assets/_builtin
```

---

## 授权 flow (release 前)

1. 产品方 real-mode 生成一轮 · review 素材质量
2. 超管 approval (avoid FAhubX-style leak · 禁大陆梗)
3. `git lfs track` 加入
4. commit + tag release
5. installer build 带进 .exe

Day 7 脚手架就绪 · 真 release 由 GA 流程触发.
