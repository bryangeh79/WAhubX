# WAhubX Installation Guide

> For: End users · English version · Malaysia market (华人 market)
> Language: English · Target: Windows 10 / 11
> Version: v1.0 (aligned with v0.12.0-m7 code-complete state)

---

## What You Need to Prepare

**Required** (minimum for product to run):
- ✅ A Windows 10 or Windows 11 machine
- ✅ A Malaysian SIM card (for WhatsApp registration)
- ✅ Internet access (home broadband or 4G both work)
- ✅ WAhubX License Key (purchase from us)

**Everything else is optional.** This guide explicitly marks each optional component.

---

## 1. System Requirements

| Item | Minimum | Recommended |
|---|---|---|
| OS | Windows 10 64-bit | Windows 11 |
| RAM | 8 GB | 16 GB |
| Storage | SSD 20 GB free | SSD 100 GB+ |
| Network | Stable broadband / 4G | Broadband + 4G backup |
| Power | Always-on preferred (warmup tasks need continuity) | Desktop / laptop on power |
| CPU | Any dual-core Intel/AMD | i5 / Ryzen 5 or above |
| GPU | **Not required** (default) | Optional: for local AI image generation, NVIDIA RTX 3060 12GB+ |

> **GPU not required.** All AI features have free fallback. See [DEPLOYMENT-MODES.en.md](./DEPLOYMENT-MODES.en.md).

[Screenshot: System info panel · Windows version + RAM]

---

## 2. Download & Install

### 2.1 Pre-flight check

Before installing, run the environment check (2 min):

```powershell
pwsh .\scripts\validate-env.ps1
```

9 checks all green = proceed. Any FAIL = fix first (see [TROUBLESHOOTING.en.md](./TROUBLESHOOTING.en.md) §2).

### 2.2 Download installer

Ask customer support for the latest `WAhubX-Setup-v1.0.x.exe` download link + SHA-256 checksum.

[Screenshot: Download page · with SHA-256]

**Verify file integrity** (optional but recommended):

```powershell
Get-FileHash .\WAhubX-Setup-v1.0.0.exe -Algorithm SHA256
```

Compare against the SHA-256 from support. If mismatch, **do not run** · re-download.

### 2.3 Run installer

Double-click `WAhubX-Setup-v1.0.0.exe`.

**Windows SmartScreen warning** (appears on first install · normal):

[Screenshot: SmartScreen blue screen "Windows protected your PC"]

1. Click **"More info"** (not the red X)
2. "**Run anyway**" button appears · click it

[Screenshot: "Run anyway" button location]

> **Why this warning?**
> V1 is not Code-Signed (saving USD 200-500/year on cert). Doesn't affect installation safety, just Windows default protection.

### 2.4 Install wizard

[Screenshot: Install wizard page 1 · Welcome]

Click **Next** all the way · defaults are fine:
- Default install path: `C:\WAhubX\`
- Create desktop shortcut ✅
- Start on boot ✅ (optional)

Installation takes **2-5 minutes** (copies Node / PostgreSQL / Redis portable binaries).

[Screenshot: Install progress bar]

After completion, don't launch yet · activate License first.

---

## 3. License Key Activation

### 3.1 First launch

Double-click the desktop "WAhubX" icon.

First launch shows **"Activation"** page:

[Screenshot: ActivatePage · Fresh Install banner]

- Banner shows **"Fresh Install"** (distinguishes first activation vs re-activation)
- Displays local App Version

### 3.2 Enter License Key

Paste the Key received upon purchase, format like:
```
WAHUBX-BASIC-XXXXX-XXXXX-XXXXX
WAHUBX-PRO-XXXXX-XXXXX-XXXXX
WAHUBX-ENTERPRISE-XXXXX-XXXXX-XXXXX
```

Click **"Activate"**.

[Screenshot: License Key input]

### 3.3 What happens

Backend:
1. Validates Key with VPS License server
2. Binds to **machine fingerprint** (one-time · needs support reset if moving to new machine)
3. Auto-creates **first Admin account** (you set password next step)
4. Sets **slot limit** per plan (Basic 10 / Pro 30 / Enterprise 50)

**Possible failures**:
- Network unreachable → check proxy / VPN · contact support
- Key already used → support can revoke old binding
- Fingerprint mismatch (changed hardware) → see [TROUBLESHOOTING.en.md](./TROUBLESHOOTING.en.md)

---

## 4. First-launch Wizard

After activation, jumps to **"Create Admin Account"**:

[Screenshot: Admin account setup · email + password]

- **Email**: Any value (for local login only · no emails sent)
- **Password**: Strong · 8+ chars · mixed case + digits
- Re-enter to confirm

Click **"Create and Login"** → Dashboard.

[Screenshot: Dashboard home]

---

## 5. Configure Proxy (Optional · Strongly Recommended)

### 5.1 Why proxy

WhatsApp heavily scrutinizes same-IP multi-account · especially in Malaysia. Without proxy:
- 1 account OK
- 2-3 accounts easily flagged same-IP and banned
- Product still runs · but account risk much higher

### 5.2 Proxy type choice

| Type | Monthly (est) | Risk | Recommended use |
|---|---|---|---|
| Home broadband direct | USD 0 (already own) | 🔴 High (fixed IP easily correlated) | Tech validation · 1 account test |
| Free proxy | USD 0 | 🔴 High (dirty IP pool / unstable) | Not recommended |
| Datacenter proxy | USD 5-20/mo | 🟡 Medium (WA flags often) | Aux use only |
| **Residential Static · 1:3-5 accounts** | **USD 40-100/mo** | 🟢 Low | **Standard pilot recommendation** |
| Mobile 4G proxy | USD 80-200/mo | 🟢 Lowest | High-quality accounts |

> Free mode works · just shorter account lifespan. Cost vs quality trade-off · customer decides.

### 5.3 Add proxy

Admin page → **Proxy Management** tab → **Add Proxy**

[Screenshot: Proxy add form]

Fill:
- **Protocol**: SOCKS5 (recommended) or HTTP
- **Host**: Proxy provider's IP · e.g. `proxy.residential-provider.com`
- **Port**: Provider-given
- **Username / Password**: Provider credentials
- **Location**: MY · Kuala Lumpur etc.
- **Group name**: Your label · for slot assignment

Click **"Test Connection"** · green check = working · red cross = contact provider.

### 5.4 Proxy allocation

When adding slots (Accounts page) · dropdown to select this proxy.

**Suggestion**: 1 residential proxy bind to 3-5 slots. Over 5 same-IP · correlation-ban risk rises.

---

## 6. Configure AI Provider (All Optional)

### 6.1 Product runs without AI

**Important**: All AI features disabled · product still operates:
- Text rewrite off → use script content_pool raw text (lower diversity, still works)
- Image gen off → use `_builtin` presets or manual upload
- Voice gen off → Piper local free fallback

AI only enhances **account personalization + lowers detection probability**.

### 6.2 Three plan choices (aligned with §B.5)

See [DEPLOYMENT-MODES.en.md](./DEPLOYMENT-MODES.en.md) for detailed tiers:

| Plan | AI Text | AI Image | AI Voice | Monthly (est) |
|---|---|---|---|---|
| **Free (zero cost)** | Off · content_pool | Off · _builtin | Piper local | **USD 0** |
| **Standard (recommended)** | DeepSeek | Replicate flux-dev or local ComfyUI | Piper | **USD 5-15/mo** |
| **Premium** | Claude Haiku | Flux-pro (Replicate) | ElevenLabs | **USD 50-200/mo** |

### 6.3 Configuration (if opted in)

Admin page → **AI Configuration** tab.

[Screenshot: AI config tab · 4 columns of providers]

Each provider has independent toggle · fill API Key · click **"Test"** to verify.

Key is AES-256-GCM encrypted on disk · never plaintext stored.

---

## 7. Register First WhatsApp Account

### 7.1 Prepare SIM card

- Malaysian local SIM (Maxis / Celcom / Digi / U-Mobile any)
- Number **never** registered WhatsApp · or aged 30+ days dormant
- SIM must receive SMS (or voice call for code)

### 7.2 Insert SIM to phone · receive code

Your PC doesn't need SIM · just need to receive SMS/call on a phone.

### 7.3 Operation in WAhubX

Accounts page → **"Add Slot"** → select proxy group → **"Start Registration"**

[Screenshot: Registration wizard · phone number input]

- Enter number · format `60xxxxxxxxx` (Malaysia country code + number · no +)
- Choose SMS or voice call
- Click **Send verification code**

### 7.4 Enter code

After receiving 6-digit code · back in WAhubX UI enter it:

[Screenshot: Code input + countdown]

- 60s countdown · expires to resend
- Wrong 3 times · 30 min lockout before retry · else number is locked

### 7.5 Registration success

[Screenshot: Account card · online status · Phase 0]

You see:
- Slot card shows number + green **"Online"** dot
- Phase = 0 (incubation · next step is warmup)

---

## 8. Start One-click Warmup (5-day default plan)

### 8.1 Why warmup

Newly registered WhatsApp **cannot send many messages immediately** · 50+ msgs in 24hrs almost certain ban.

WAhubX built-in 5-day warmup (§B.8):
- Day 1-2 · Incubation · receive only · occasional read receipts
- Day 3 · Preheat · small amount send to old contacts
- Day 4-5 · Active · join groups + post status + two-way chat

### 8.2 Start

Dashboard → click newly registered account → **"Start Warmup"** button

[Screenshot: Warmup start confirmation modal]

System auto-generates 5-day calendar · 5-20 tasks per day · inserts to `task` queue.

### 8.3 Monitor progress

**Warmup page** tab shows daily schedule + completion:

[Screenshot: Warmup page · 5-day progress bars]

**Tasks page** shows minute-level tasks:

[Screenshot: Task queue · pending/running/done columns]

### 8.4 Pass Phase Gate

End of day 5 · auto promote to Phase 2 (Active) · can manually disable/override.

Do **not manually send during warmup** · fully automatic · prevents human error that ruins account.

---

## 9. UI Tour

### 9.1 Dashboard

[Screenshot: Dashboard overview]

- Slot thumbnail cards (online/offline/takeover status indicators)
- Today's task progress
- Alert list (high-risk account warnings)

### 9.2 Accounts (Slot management)

[Screenshot: Accounts page]

- Per slot: phone · phase · health score · bound persona · last activity
- Actions: start warmup / pause / takeover / unbind / delete

### 9.3 Scripts

[Screenshot: Scripts page]

- Imported script packs (100 scripts preset · §C)
- Enable/disable · view content
- Manual import custom packs (.wzip format)

### 9.4 Tasks (Task queue)

[Screenshot: Tasks page]

- Real-time task stream · pending / running / done / failed
- 6-path dispatch results visualized (§B.7)
- Single task details + retry

### 9.5 Health (Risk score)

[Screenshot: Health page]

- Per-account risk_level + score (§B.12)
- Last 30 days risk_event log
- High level auto Phase 0 rollback (debounce 30 min)

### 9.6 Assets (New in M7)

[Screenshot: Assets page · persona library + asset list]

- Persona library (AI-generated virtual identities)
- Per-persona image/voice pool + quota
- Upload · generate · delete

### 9.7 Backup

[Screenshot: Backup page]

- Daily auto snapshot list
- Manual export `.wab` (encrypted pack · recoverable across machines)
- Import `.wab` · hardware change E2 recovery

### 9.8 Upgrade

[Screenshot: Upgrade page]

- Current version
- Manual upload `.wupd` upgrade pack (V1 no auto-download)
- Auto pre-upgrade backup + rollback on failure

---

## 10. Next Steps

- Successful first install → see [QUICK-START.en.md](./QUICK-START.en.md) for 30-min path
- Hit issues → [TROUBLESHOOTING.en.md](./TROUBLESHOOTING.en.md)
- Want to add 2nd account → add proxy · split groups to avoid same-IP · Accounts page add slot

---

## About Paid Services · Don't Worry

We only sell you one thing: **License Key**.

Everything else (proxies · AI APIs · voice cloud) is **optional enhancement**. Zero extra cost can also run · just lower account quality.

Tiers in [DEPLOYMENT-MODES.en.md](./DEPLOYMENT-MODES.en.md).

---

_Last updated 2026-04-21 · Aligned with v0.12.0-m7_
