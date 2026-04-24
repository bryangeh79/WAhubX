#!/bin/bash
# 爬 wachannelsfinder.com · 预计 ~5600 条
set -e
OUT="$(dirname "$0")/wacf.raw.csv"
URLS_FILE="$(dirname "$0")/wacf-urls.tmp"

echo "[1/2] Fetching all 28 post-sitemaps..."
> "$URLS_FILE"
for i in $(seq 1 28); do
  curl -sL "https://wachannelsfinder.com/post-sitemap${i}.xml" --max-time 15 | \
    grep -oE "https://wachannelsfinder\\.com/channels/[^<]+" >> "$URLS_FILE" || true
done
TOTAL=$(wc -l < "$URLS_FILE")
echo "Total URLs: $TOTAL"

echo "[2/2] Fetching each detail page..."
> "$OUT"
COUNT=0
SUCCESS=0
while IFS= read -r url; do
  COUNT=$((COUNT+1))
  HTML=$(curl -sL --max-time 8 "$url" || true)
  WA=$(echo "$HTML" | grep -oE "whatsapp\\.com/channel/[A-Za-z0-9_-]{20,}" | head -1)
  if [ -z "$WA" ]; then continue; fi
  INVITE=$(echo "$WA" | sed 's|.*channel/||')
  NAME=$(echo "$HTML" | grep -oE '<meta property="og:title" content="[^"]+"' | head -1 | sed "s/.*content=\"//; s/\"[^\"]*$//; s/'s Official WhatsApp Channel Link//; s/ - Whatsapp Channels Finder//" | head -c 100)
  DESC=$(echo "$HTML" | grep -oE '<meta property="og:description" content="[^"]+"' | head -1 | sed 's/.*content="//; s/" *$//' | head -c 200)
  CATS=$(echo "$HTML" | grep -oE '/category/[a-z0-9-]+/' | sed 's|/category/||; s|/$||' | sort -u | tr '\n' '|' | sed 's/|$//')
  printf "%s|%s|%s|%s|\n" "$NAME" "$INVITE" "$CATS" "$DESC" >> "$OUT"
  SUCCESS=$((SUCCESS+1))
  if [ $((COUNT % 50)) -eq 0 ]; then
    echo "  progress $COUNT/$TOTAL · success=$SUCCESS"
  fi
done < "$URLS_FILE"
echo "==== DONE ===="
echo "Total fetched: $COUNT"
echo "With valid invite: $SUCCESS"
rm -f "$URLS_FILE"
