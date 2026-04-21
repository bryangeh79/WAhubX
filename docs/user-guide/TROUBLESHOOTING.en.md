# WAhubX Troubleshooting Checklist

> Common issues · diagnosis · fix steps · log locations

---

## General diagnosis steps

Post-install any anomaly · check these 4 first:

1. **Backend alive?** · PowerShell `curl http://localhost:9700/api/v1/health` · 200 = OK
2. **Docker PG running?** (dev) / **PortablePG running?** (prod): `netstat -ano | findstr 5432`
3. **Redis on?** · `netstat -ano | findstr 6379`
4. **Logs at** · `C:\WAhubX\data\logs\backend-*.log` · last 50 lines · look for `ERROR` / `WARN` keywords

---

## 1. Install fails / SmartScreen blocks

### Symptom
Double-click `.exe` Windows blue screen "Windows protected your PC" · no "Run anyway" option.

### Cause
- No Code Signing cert (V1 skips · saves USD 200-500/yr)
- Some enterprise Windows policies completely block unsigned

### Fix
- Click **"More info"** → "Run anyway" appears → click
- If no "More info": right-click `.exe` → Properties → bottom "Unblock" check → OK → re-double-click
- Enterprise/AD-managed machines: contact IT to whitelist · or install on non-managed machine

### Logs
Install failure leaves no product log · check Windows Event Viewer → Application.

---

## 2. Backend won't start

### Symptom
Click desktop icon · flash-then-exit · or UI spins then "Cannot connect to backend".

### Diagnosis tree

**2A. PostgreSQL not running**

```powershell
netstat -ano | findstr ":5434"
```

Empty = PG not up. See `C:\WAhubX\logs\pg\postgresql-*.log`.

Fix:
- Check `C:\WAhubX\pgsql\` directory complete (installer should've set up)
- Manual start: `C:\WAhubX\scripts\start-pg.bat`
- Port conflict (other PG already running): change `POSTGRES_PORT` in `.env`

**2B. Redis not running**

```powershell
netstat -ano | findstr ":6381"
```

Same approach. Start: `C:\WAhubX\scripts\start-redis.bat`.

**2C. Port 9700 taken**

```powershell
netstat -ano | findstr ":9700"
```

Taken by another program (common: Node.js dev project / React frontend):
- Close offending program · or change WAhubX `.env` PORT
- Don't `taskkill /IM node.exe` (kills all Node)

**2D. `.env` missing / password wrong**

Installer should auto `generate-env.js` on first launch. If `C:\WAhubX\.env` doesn't exist:
- Rerun `C:\WAhubX\scripts\init-env.bat`

### Log locations
- Backend: `C:\WAhubX\data\logs\backend-YYYY-MM-DD.log`
- PG: `C:\WAhubX\logs\pg\postgresql-*.log`
- Redis: `C:\WAhubX\logs\redis\redis.log`

---

## 3. License activation fails

### Symptom
Enter Key click activate · red error / timeout.

### Diagnosis

**3A. Network unreachable to VPS**

```powershell
curl https://license.wahubx.com/health
```

Timeout → VPN / firewall / proxy blocked VPS domain.

**3B. Key already used** (machine change)

Error: `License already bound to another machine`

Fix: Contact support · provide old + new machine fingerprints · revoke old binding.

**3C. Fingerprint mismatch** (hardware major change)

Error: `Machine fingerprint mismatch`

Fix · 3 paths (see UPGRADE.md §E2):
- Path 1: Use old env key (if backed up) · run `C:\WAhubX\scripts\restore-env-key.bat`
- Path 2: Import `.wab` backup · Backup page → Import
- Path 3: Contact support for License rebind reset

**3D. Key expired**

Error: `License expired`

Fix: Renew or swap Key.

### Logs
`data/logs/backend-*.log` grep `LicenseModule`.

---

## 4. WhatsApp registration fails

### Symptom
Send code fails / code entered but still rejected.

### 4A. SIM has WA history / blacklisted

- Brand new SIM · first try installing WhatsApp on phone (don't actually use · just verify can receive code)
- If phone WhatsApp install fails · number has history · swap SIM

### 4B. Code not received

- Wait 60s then switch to voice call
- Swap carrier: Maxis / Celcom / Digi / U-Mobile
- Note VoIP numbers often can't receive voice call · prefer physical SIM

### 4C. IP history dirty

Error: `Banned IP` / immediate ban

- Rotate proxy IP (residential proxy control panel usually supports rotate)
- Home broadband direct: reboot modem for new IP (ISP dynamic)
- Mobile 4G: toggle airplane mode

### 4D. Too many wrong codes

3 wrong codes → 30 min number lockout · wait.

### Logs
`data/logs/backend-*.log` grep `BaileysService` · `BindSessionService`.

---

## 5. Proxy unreachable

### Symptom
Add proxy → test connection → red cross.

### Diagnosis

```powershell
curl --proxy socks5://user:pass@host:port https://ifconfig.me
```

- Returns IP = proxy works · issue on WAhubX side · retry or check `BaileysService` log
- Timeout = provider issue · contact provider
- 401 = wrong credentials
- 403 = provider banned your account (unpaid / abuse)

### Common latency

- Residential · ping 100-300ms normal
- \> 500ms · consider different region (pick Malaysia local · not US)

### Logs
grep `ProxyService` + `axios.*timeout`.

---

## 6. AI Provider call fails

### Symptom
Dashboard → AI Config → click **"Test"** · red cross.
Or script runs · text not rewritten · log shows `AI rewrite fail, fallback pool`.

### **First ask yourself** (very important)

> **Do you want AI features?**

If no: **Keep AI off · product works fine** · falls back to script raw text (§B.4 three-dim degradation). This is **normal behavior** · not a bug.

### If you do want AI

**6A. OpenAI/DeepSeek/Claude/Gemini Key wrong**

- Regenerate Key from provider console · paste
- Check **has balance** (Anthropic / Google new accounts need topup)

**6B. endpoint URL wrong** (self-host / OpenAI-compat scenario)

- Correct format: `https://api.deepseek.com/v1` (trailing `/v1` · no `/chat/completions`)
- SDK auto-appends `/chat/completions`

**6C. Model name wrong**

- DeepSeek: `deepseek-chat`
- OpenAI: `gpt-4o-mini` (cheap) / `gpt-4o` (expensive)
- Claude: `claude-3-5-haiku-latest`
- Gemini: `gemini-1.5-flash`

**6D. Network blocked**

- User PC in mainland China → OpenAI / Anthropic / Google domains likely blocked
- Fix: configure proxy (Key independent · not via proxy rules) · or use DeepSeek (accessible from China)

### Logs
grep `ai-text.service` / `provider=`.

---

## 7. Baileys disconnects / QR expires frequently

### Symptom
- Slot online for seconds → offline
- QR refreshes frequently · can't scan

### 7A. Same-IP multi-account · WA correlation

Most common cause. Fix: add proxy. See [DEPLOYMENT-MODES.en.md](./DEPLOYMENT-MODES.en.md).

### 7B. Proxy unstable

Latency fluctuates · provider IP pool rotating. Switch to static residential.

### 7C. Socket overload

backend log many `ECONNRESET` / `EPIPE`:
- Restart backend · clear in-memory socket pool
- V1 doesn't do redis rehydrate · relies on session disk persistence (`data/slots/<n>/wa-session/`)

### 7D. QR can't scan

- QR expires in 2 min · fully scan then refresh
- Phone WhatsApp too old · upgrade to latest
- Phone can't reach WhatsApp servers · try VPN

### Logs
grep `BindSessionService` / `baileys.service` / `disconnected`.

---

## 8. Warmup tasks don't execute

### Symptom
- After starting warmup · Tasks page empty or pending stuck
- Health page "last active" stalls

### 8A. Dispatcher not ticking

log grep `DispatcherService started`:
- Should see `poll interval=3000ms`
- Not seen → backend not started properly (back to §2)

### 8B. Phase Gate

Task stuck pending · log has `skip-health-high` / `phase-gate-block`:
- Account in high risk · paused · see Health page
- Or Phase insufficient · status_post needs ≥ Phase 2

### 8C. All 6 skip paths match

log grep `skip-`:
- `skip-global-capacity` · too many tasks · wait
- `skip-account-busy` · this account has a running task
- `skip-ip-group-busy` · same-proxy IP another account running
- `skip-night-window` · 02-06 night window
- `skip-takeover-active` · you're in takeover mode · release takeover

### 8D. Executor not registered

log `Unknown task_type`:
- Script uses new task_type · corresponding executor missing
- V1 should have chat / warmup / script_chat / status_post / status_browse

### Logs
grep `DispatcherService`.

---

## 9. Status Post text-only · no image

### Symptom
Status task succeeds · but phone WhatsApp only shows text status · no image.

### Cause
4-layer degradation (§B.20) hit Layer 3 (text) instead of Layer 1/2 (image).

### Diagnosis

log grep `layer1-` `layer2-` `layer3-`:
- `layer1-persona-pool-hit` passed · no `image-sent` → file missing
- `layer2-builtin-hit` same issue
- Direct `layer3-text-sent` → persona + _builtin both empty

### Fix

- **persona-owned empty**: Assets page → select persona → upload or generate
- **_builtin empty** (V1 installer didn't seed real assets · stub mode only): run `scripts/generate-builtin-assets.js --mode real` (needs Flux) · or manually copy `.jpg` to `C:\WAhubX\data\assets\_builtin\image\_builtin_images_life\`

### Logs
grep `StatusPostExecutor`.

---

## 10. Upgrade (.wupd) fails

### Symptom
Upgrade page upload `.wupd` → error.

### 10A. Invalid signature

Error: `signature_valid: false`

- `.wupd` not signed by us · or file corrupted · re-download
- Absolutely do not modify `.wupd` · signature invalidates

### 10B. Version downgrade

Error: `version_compat: downgrade`

- Downgrading from higher to lower version not supported
- Upgrade `.wupd` from_version must match current version

### 10C. Migration failed

Error: `migration execution failed`

- Auto-rolled back to pre-upgrade backup
- See log which migration broke · contact support with log

### Logs
grep `UpdateService` / `migration`.

---

## Packaging logs for support

Issue can't be resolved · send log pack to support:

PowerShell:
```powershell
$zip = "$env:USERPROFILE\Desktop\wahubx-logs-$(Get-Date -Format yyyyMMdd-HHmm).zip"
Compress-Archive -Path "C:\WAhubX\data\logs\*","C:\WAhubX\logs\*" -DestinationPath $zip
Write-Host "Logs: $zip"
```

**Sensitive info check** · before sending confirm log has no:
- License Key plaintext (should be sanitized · double-check)
- API Key plaintext (should be sanitized)
- Real WhatsApp message content (typically not logged · but confirm)
- If found · delete before send

---

_Last updated 2026-04-21_
