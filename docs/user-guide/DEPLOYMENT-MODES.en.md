# Deployment Modes · 3-tier Ladder (Free / Standard / Premium)

> All paid components are **optional** · WAhubX core product doesn't depend on them
> Choice is cost vs account quality trade-off · customer decides

---

## TL;DR · Which one

| Scenario | Recommended |
|---|---|
| Tech validation · 1-2 account test · zero budget | **Mode A · Free** |
| Pilot customer · 3-10 accounts · balance | **Mode B · Standard** (main product push) |
| Scale · 10+ accounts · high ARPU | **Mode C · Premium** |

All modes **run out of the box** · switching is just Settings UI toggles.

---

## Mode A · Free Tier

### Components

| Feature | Plan | Monthly |
|---|---|---|
| Proxy | Home broadband direct / free proxy | USD 0 |
| AI text rewrite | **Off** · script content_pool raw | USD 0 |
| AI image (avatar / status) | **Off** · `_builtin` preset + manual upload | USD 0 |
| AI voice | **Piper local** (only free AI · auto) | USD 0 |
| VPS (License server) | Our side · not customer concern | — |

**Total: USD 0 / month**

### Does it run?

Yes. All core functions work.

### Quality compromises

- 🔴 **Same-IP multi-account** → WhatsApp correlation-ban risk very high · recommend 1-account test
- 🟡 **Text repetition** → All accounts share script raw · content homogeneous · detection prob rises
- 🟡 **Avatar/status image repetition** → Only `_builtin` (~50 images) · multi-account hard to individualize
- 🟢 **Voice OK** · Piper local per-account independent

### Fits

- Engineer/tech users validating product
- Small-scale non-critical account testing
- Zero budget · tolerant of 2-4 week account lifespan

### Doesn't fit

- Production 3+ accounts
- E-commerce / private community real business

---

## Mode B · Standard (Pilot) · ⭐ Recommended

### Components

| Feature | Plan | Monthly |
|---|---|---|
| Proxy | Residential static · 1 IP : 3-5 accounts | USD 40-100 |
| AI text rewrite | **DeepSeek** (cheapest) · or OpenAI-compat | USD 3-5 |
| AI image | **ComfyUI local** (need GPU) **OR** Replicate flux-dev | USD 0 (local) / USD 5-10 (cloud) |
| AI voice | Piper local (same as Mode A) | USD 0 |

**Total: ~USD 48-115 / month** (by proxy + AI combo)

### Sub-option · AI Image

**B1 · ComfyUI local** (if you have NVIDIA GPU)

- Hardware: RTX 3060 12GB+ (VRAM is the key · not CUDA cores)
- Download: https://github.com/comfyanonymous/ComfyUI
- Model: flux-dev.safetensors (~23 GB) · https://huggingface.co/black-forest-labs/FLUX.1-dev
- Launch: `python main.py` · default `http://127.0.0.1:8188`
- WAhubX Settings → AI Config → Flux backend = **flux-local**
- Pro: Zero cloud cost · no API rate limits
- Con: Some CLI knowledge needed · 23GB initial download

**B2 · Replicate cloud** (no GPU / lazy config)

- Register: https://replicate.com
- Get API Key (Account → API Tokens)
- WAhubX Settings → AI Config → Flux backend = **flux-replicate** · paste Token
- Model keep default `black-forest-labs/flux-dev`
- Cost: ~USD 0.003 / image · first 4 candidates per account ≈ USD 0.012 · 100 accounts ≈ USD 1.20 one-off + ongoing status replenish ~USD 5/month

### Cost detail (Mode B · 5-account ops)

| Item | Estimate |
|---|---|
| Residential static proxy 1 (covers 5 accounts) | USD 40-60/mo |
| DeepSeek API (100k tokens/mo) | ~USD 3-5/mo |
| Replicate (status replenish · ~500 img/mo) | ~USD 5/mo |
| **Total** | **USD 48-70 / month** |

### Account quality

- 🟢 Same-proxy ≤ 5 accounts · low correlation-ban probability
- 🟢 AI rewrite → high text diversity per account
- 🟢 Persona avatar independent · strong visual differentiation
- 🟡 Voice still Mainland accent (Piper huayan · V1.1 fine-tune Malaysian Chinese voice)

### Fits

- **Our product's pilot customer first choice**
- Malaysian Chinese e-commerce / micro-business · 3-10 account scale
- Willing to pay ~USD 50/mo for account safety

---

## Mode C · Premium

### Components

| Feature | Plan | Monthly |
|---|---|---|
| Proxy | Residential static 1:1-2 · or mobile 4G pool | USD 100-200 |
| AI text | **Claude 3.5 Haiku** (best quality cheap model) | USD 10-30 |
| AI image | Replicate **flux-pro** (stronger than flux-dev) | USD 20-50 |
| AI voice | **ElevenLabs** cloud (natural / accent tunable) | USD 22+/mo |

**Total: ~USD 152-302 / month**

### Extra capabilities

- ElevenLabs optional Malaysian Chinese voice clone (upload 30s sample)
- Flux-pro more natural portrait · lower AI-identifiable probability
- Claude Haiku text closer to human expression · less "AI-flavor"

### Fits

- High ARPU business (beauty / insurance / property · per-account monthly output USD 500+)
- Scale 10-50 accounts
- Team has budget · quality-first

---

## Switching modes

All done in **Settings / AI Config** tab:

[Screenshot: AI Config tab · 4 provider columns toggle]

- Each provider independent **Enable / Disable** toggle
- Paste respective API Key (AES-256-GCM encrypted on disk)
- Click **"Test"** to verify Key works
- Disabled = auto fallback (see §B.4 three-dimensional degradation)

**Switching requires no restart** · next task dispatch takes effect immediately.

---

## Proxy Provider Guide (generic · for Mode B/C)

### Recommended vendors (Malaysia market)

- **IPRoyal** · Residential Static · https://iproyal.com
- **Bright Data** (formerly Luminati) · largest / most expensive / most stable
- **Oxylabs** · Enterprise grade

### Avoid

- ❌ Datacenter proxies (WA batch-flagged)
- ❌ Free proxy sites (dirty IP pool · may have been used by bad actors)
- ❌ VPN services (Softether / NordVPN · shared IP · not multi-account scenarios)

### Budget alternatives

- Own 4G hotspot · manual IP rotate · 1-account dedicated · but loses stability
- Home broadband direct · 1 account OK · 2+ account risk rises sharply

---

## FAQ

**Q: I totally don't want to pay for APIs · can it run?**
A: Mode A does. Accept shorter account lifespan + higher multi-account correlation risk.

**Q: Local ComfyUI storage needed?**
A: Model 23GB + output cache ~10GB · plan 50GB.

**Q: Will Replicate rate-limit me?**
A: Personal account default ~10 req/s · enough. Large scale can upgrade.

**Q: How many accounts can share one proxy?**
A: Residential static 3-5 upper bound · over 5 correlation risk rises sharply. Mobile 4G can loosen to 10.

**Q: Is ElevenLabs necessary?**
A: Not at all. Piper local free · just Mainland accent · short voice (<8s) diff hardly noticed.

---

_Last updated 2026-04-21_
