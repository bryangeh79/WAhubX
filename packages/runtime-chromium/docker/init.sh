#!/bin/bash
# 2026-04-25 · Chromium runtime 容器 entrypoint
# 顺序:
#   1. iptables 封 UDP/TCP 53 (C7.3.1 DNS leak 工程封)
#   2. log iptables 规则 dump (POC 验收证据)
#   3. exec node 主进程 (signal 透传)
set -euo pipefail

echo "[init] $(date -Iseconds) · slot runtime container booting · slotId=${SLOT_ID:-unset}"

# C7.3.1 · 封 DNS 直连出口 (强制 Chromium 走 SOCKS5h hostname resolution)
# 需 NET_ADMIN cap · docker run --cap-add=NET_ADMIN
if iptables -L > /dev/null 2>&1; then
  iptables  -I OUTPUT -p udp --dport 53 -j DROP || true
  iptables  -I OUTPUT -p tcp --dport 53 -j DROP || true
  ip6tables -I OUTPUT -p udp --dport 53 -j DROP || true
  ip6tables -I OUTPUT -p tcp --dport 53 -j DROP || true
  echo "[init] iptables UDP/TCP 53 DROP rules applied (v4 + v6)"
  echo "[init] === iptables OUTPUT chain dump ==="
  iptables  -L OUTPUT -n -v | head -20
  ip6tables -L OUTPUT -n -v | head -20
  echo "[init] === iptables dump end ==="
else
  echo "[init] WARNING: iptables not available · NET_ADMIN cap missing · DNS leak NOT enforced"
  echo "[init] WARNING: 在 SaaS 部署必须开 cap_add: [NET_ADMIN] · 否则 C7.3 不通过"
fi

# 必传环境变量检查 (D2 阶段 · WS bridge D4-5 才接 · 当前可选)
: "${SLOT_ID:?SLOT_ID required}"
: "${TENANT_ID:?TENANT_ID required}"
: "${SESSION_DIR:=/app/wa-data}"
# CONTROL_PLANE_WS_URL D4-5 才用 · 当前可选
: "${CONTROL_PLANE_WS_URL:=}"

# 用 user-data-dir 持久化 (cookies / IndexedDB / cache)
mkdir -p "$SESSION_DIR"
echo "[init] session dir: $SESSION_DIR ($(du -sh $SESSION_DIR 2>/dev/null | cut -f1))"

# 启 Node runtime · D9 改: dist 在 runtime-chromium 子包内
echo "[init] launching node runtime..."
exec node /app/packages/runtime-chromium/dist/index.js
