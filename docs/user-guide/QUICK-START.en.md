# WAhubX · Quick Start (30 minutes)

> For users with some tech background · shortest path · full details in [INSTALLATION.en.md](./INSTALLATION.en.md)

---

## Prereqs (before install)

- ✅ Windows 10/11 · 8GB+ RAM · 20GB+ SSD
- ✅ Malaysian SIM (brand new / 30+ days dormant) + phone that receives SMS
- ✅ WAhubX License Key
- ✅ Network reaches github.com + your VPS license server
- 🟡 **Optional**: Proxy account · AI API Key (zero-cost mode also works)

---

## Full flow (30 min)

### ① Pre-flight · Download · Verify · Install (~10 min)

**Run pre-flight first** (2 min):
```powershell
pwsh .\scripts\validate-env.ps1
```
All green or warnings-only = proceed.

**Download + verify**:
```powershell
# Compare SHA-256 (from support)
Get-FileHash .\WAhubX-Setup-v1.0.0.exe -Algorithm SHA256
```

Double-click `.exe` → SmartScreen blue screen → **"More info"** → **"Run anyway"** → Next, Next, Next → installs to `C:\WAhubX\`.

### ② Activate License (~2 min)

Launch via desktop icon → paste License Key → **"Activate"**.

Backend does: VPS verify · bind fingerprint · create first admin account. Next page sets password.

### ③ Login · Create Admin (~1 min)

Email any (local only) + strong password → Dashboard.

### ④ (Optional) Configure Proxy (~3 min · skippable)

Admin → **Proxy Management** → Add:
- Protocol SOCKS5
- Host / Port / Credentials (from provider)
- **Test Connection** · green check

> No proxy = direct home IP · accounts banned faster. 1-account test can skip.

### ⑤ (Optional) Configure AI (~3 min · skippable)

Admin → **AI Configuration**.

**Cheapest plan (standard pilot rec)**:
- Text: DeepSeek (~USD 3-5/mo) · paste Key
- Image: Skip (use `_builtin` or manual upload)
- Voice: Piper local · default on · zero config

> No Key = AI off · product works normally · uses script raw text + preset images.

### ⑥ Register 1st account (~5 min)

Accounts page → **Add Slot** → select proxy group → **Start Registration**.

Enter phone `60xxxxxxxxx` → choose SMS → **Send Code**.

Phone receives 6-digit code → enter in UI → registration success → green slot dot.

### ⑦ Start 5-day warmup (~1 min)

Dashboard → click new account card → **Start Warmup**.

Auto-generates 5-day calendar · 5-20 tasks/day · enters `task` queue. **Keeps queuing even when PC off** (resume on boot).

### ⑧ Observe (ongoing)

Tasks / Warmup / Health pages anytime. **Don't manually send during Phase 0-2 5-day window** · let it cook.

---

## Common immediate issues

| Symptom | 30-sec fix |
|---|---|
| SmartScreen blue screen | Click "More info" then "Run anyway" |
| License activation timeout | Check network / VPN · retry |
| Can't receive SMS code | Switch to voice call · or swap carrier SIM |
| Phase 0 not sending | Normal · incubation receives only |
| AI off still works? | Yes · falls back to script raw text + _builtin images |

See [TROUBLESHOOTING.en.md](./TROUBLESHOOTING.en.md) for more.

---

## Then?

- 1 account running → add proxy · open 2nd-5th (≤ 5 per proxy group)
- Improve account quality → [DEPLOYMENT-MODES.en.md](./DEPLOYMENT-MODES.en.md) pick Standard/Premium
- V1 known limits → [../KNOWN-LIMITATIONS-V1.md](../KNOWN-LIMITATIONS-V1.md) (Chinese only · technical)

---

_Last updated 2026-04-21 · Aligned with v0.12.0-m7_
