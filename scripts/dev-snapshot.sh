#!/bin/bash
# M11 Day 5 · dev env snapshot · 防 smoke brick
#
# 用途: 在 Day 5 本地 smoke 前/后备份 data/ + backups/ + DB dump
# 失败 → restore 还原到备份点
#
# Usage:
#   ./scripts/dev-snapshot.sh snapshot [--notes "..."]   # 备份当前状态
#   ./scripts/dev-snapshot.sh list                       # 列已有 snapshots
#   ./scripts/dev-snapshot.sh restore <name>             # 从某 snapshot 还原 (会停 backend + docker pg)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SNAPSHOT_DIR="${REPO_ROOT}/dev-snapshots"
mkdir -p "$SNAPSHOT_DIR"

# ── 命令路由 ──
CMD="${1:-}"
case "$CMD" in
  snapshot)
    STAMP=$(date +%Y-%m-%d_%H-%M-%S)
    shift
    NOTES=""
    if [ "${1:-}" = "--notes" ]; then
      NOTES="$2"
    fi
    NAME="dev-snapshot-${STAMP}"
    SNAP_PATH="${SNAPSHOT_DIR}/${NAME}.tar.gz"

    echo "[1/3] Stopping backend if running..."
    BACKEND_PIDS=$(netstat -ano 2>/dev/null | grep ":3000.*LISTENING" | awk '{print $5}' | sort -u || true)
    if [ -n "$BACKEND_PIDS" ]; then
      for pid in $BACKEND_PIDS; do
        taskkill //F //PID $pid 2>&1 | head -1
      done
      sleep 2
    else
      echo "  backend not running"
    fi

    echo "[2/3] Dumping DB..."
    DB_DUMP="${SNAPSHOT_DIR}/${NAME}.sql"
    docker exec wahubx-dev-pg pg_dump -U wahubx -d wahubx --clean --if-exists --no-owner --no-privileges > "$DB_DUMP" 2>/dev/null
    echo "  DB dump · $(du -h "$DB_DUMP" | cut -f1)"

    echo "[3/3] tarball data/ + backups/ + DB dump + notes..."
    cd "$REPO_ROOT"
    tar -czf "$SNAP_PATH" \
      -C "$REPO_ROOT" \
      "packages/backend/data" \
      "packages/backend/backups" 2>/dev/null \
      || echo "  (one or both dirs missing · 继续)"
    # 把 DB dump + notes 也打进同 tarball
    cd "$SNAPSHOT_DIR"
    tar -rzf "$SNAP_PATH" "${NAME}.sql" 2>/dev/null || gzip -c "${NAME}.sql" >> "$SNAP_PATH"
    rm "$DB_DUMP"

    # notes 文件
    echo "$NOTES" > "${SNAPSHOT_DIR}/${NAME}.notes.txt"
    echo "  created at: $(date -Iseconds)" >> "${SNAPSHOT_DIR}/${NAME}.notes.txt"
    echo "  repo commit: $(cd "$REPO_ROOT" && git rev-parse --short HEAD)" >> "${SNAPSHOT_DIR}/${NAME}.notes.txt"

    SIZE=$(du -h "$SNAP_PATH" | cut -f1)
    echo ""
    echo "========================================================"
    echo "✓ Snapshot saved · $SNAP_PATH · $SIZE"
    echo "  Notes: ${SNAPSHOT_DIR}/${NAME}.notes.txt"
    echo ""
    echo "  Restore: ./scripts/dev-snapshot.sh restore $NAME"
    echo "========================================================"
    ;;

  list)
    echo "Available snapshots (${SNAPSHOT_DIR}):"
    if [ -d "$SNAPSHOT_DIR" ]; then
      for f in "$SNAPSHOT_DIR"/*.tar.gz; do
        [ -f "$f" ] || continue
        NAME=$(basename "$f" .tar.gz)
        SIZE=$(du -h "$f" | cut -f1)
        NOTES="(no notes)"
        [ -f "${SNAPSHOT_DIR}/${NAME}.notes.txt" ] && NOTES=$(head -1 "${SNAPSHOT_DIR}/${NAME}.notes.txt")
        echo "  $NAME · $SIZE · $NOTES"
      done
    fi
    ;;

  restore)
    NAME="${2:?usage: restore <snapshot-name>}"
    SNAP_PATH="${SNAPSHOT_DIR}/${NAME}.tar.gz"
    if [ ! -f "$SNAP_PATH" ]; then
      echo "ERROR: snapshot '$NAME' not found"
      ls "$SNAPSHOT_DIR"/*.tar.gz 2>/dev/null | head -5
      exit 1
    fi

    echo "⚠ DESTRUCTIVE: 将覆盖当前 data/ + backups/ + DB · 按 Ctrl-C 取消"
    echo "  Restoring from: $SNAP_PATH"
    sleep 5

    echo "[1/4] Stopping backend..."
    BACKEND_PIDS=$(netstat -ano 2>/dev/null | grep ":3000.*LISTENING" | awk '{print $5}' | sort -u || true)
    if [ -n "$BACKEND_PIDS" ]; then
      for pid in $BACKEND_PIDS; do
        taskkill //F //PID $pid 2>&1 | head -1
      done
      sleep 2
    fi

    echo "[2/4] Clearing current data/ + backups/..."
    rm -rf "${REPO_ROOT}/packages/backend/data" 2>/dev/null || true
    rm -rf "${REPO_ROOT}/packages/backend/backups" 2>/dev/null || true

    echo "[3/4] Extracting snapshot..."
    cd "$REPO_ROOT"
    tar -xzf "$SNAP_PATH"

    echo "[4/4] Restoring DB from dump..."
    # 提 DB dump 出来 · 灌回
    EXTRACT_DIR="${SNAPSHOT_DIR}/restore-tmp-$$"
    mkdir -p "$EXTRACT_DIR"
    tar -xzf "$SNAP_PATH" -C "$EXTRACT_DIR" "${NAME}.sql" 2>/dev/null || echo "  (no SQL in tarball · skipping DB restore)"
    if [ -f "${EXTRACT_DIR}/${NAME}.sql" ]; then
      docker exec -i wahubx-dev-pg psql -U wahubx -d wahubx < "${EXTRACT_DIR}/${NAME}.sql" > /dev/null 2>&1
      echo "  DB restored"
    fi
    rm -rf "$EXTRACT_DIR"

    echo ""
    echo "✓ Restore complete. Start backend: cd packages/backend && pnpm run start:prod"
    ;;

  *)
    echo "Usage:"
    echo "  $0 snapshot [--notes \"...\"]     备份当前 data/ + backups/ + DB"
    echo "  $0 list                         列已有 snapshots"
    echo "  $0 restore <name>               从 snapshot 还原 (DESTRUCTIVE)"
    exit 1
    ;;
esac
