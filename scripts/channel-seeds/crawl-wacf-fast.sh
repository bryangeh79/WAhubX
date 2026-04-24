#!/bin/bash
# 并发版爬虫 · 12 线程
set -e
OUT="$(dirname "$0")/wacf.raw.csv"
URLS_FILE="$(dirname "$0")/wacf-urls.tmp"

echo "[1/2] Fetching 28 post-sitemaps..."
> "$URLS_FILE"
for i in $(seq 1 28); do
  curl -sL "https://wachannelsfinder.com/post-sitemap${i}.xml" --max-time 15 | \
    grep -oE "https://wachannelsfinder\\.com/channels/[^<]+" >> "$URLS_FILE" || true
done
TOTAL=$(wc -l < "$URLS_FILE")
echo "Total URLs: $TOTAL"

# 每 URL 调用的处理函数
extract_one() {
  local url="$1"
  local HTML
  HTML=$(curl -sL --max-time 6 "$url" 2>/dev/null) || return
  local WA
  WA=$(echo "$HTML" | grep -oE "whatsapp\\.com/channel/[A-Za-z0-9_-]{20,}" | head -1)
  [ -z "$WA" ] && return
  local INVITE="${WA#*channel/}"
  local NAME
  NAME=$(echo "$HTML" | grep -oE '<meta property="og:title" content="[^"]+"' | head -1 | sed "s/.*content=\"//; s/\"[^\"]*$//; s/'s Official WhatsApp Channel Link//; s/ - Whatsapp Channels Finder//" | head -c 100 | tr -d '\n\r')
  local DESC
  DESC=$(echo "$HTML" | grep -oE '<meta property="og:description" content="[^"]+"' | head -1 | sed 's/.*content="//; s/" *$//' | head -c 200 | tr -d '\n\r')
  local CATS
  CATS=$(echo "$HTML" | grep -oE '/category/[a-z0-9-]+/' | sed 's|/category/||; s|/$||' | sort -u | tr '\n' '|' | sed 's/|$//')
  printf "%s|%s|%s|%s|\n" "$NAME" "$INVITE" "$CATS" "$DESC"
}
export -f extract_one

echo "[2/2] Parallel fetch (12 concurrent)..."
> "$OUT"
# xargs -P 12 并发
cat "$URLS_FILE" | xargs -P 12 -I {} bash -c 'extract_one "$@"' _ {} >> "$OUT" 2>/dev/null

SUCCESS=$(wc -l < "$OUT")
echo "==== DONE ===="
echo "Total URLs: $TOTAL"
echo "Extracted: $SUCCESS"
rm -f "$URLS_FILE"
