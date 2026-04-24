#!/bin/bash
# 从 whchannels.com 爬真 WA channel invite codes
# 输出: channels.raw.csv · 格式 name|wa_url|tags|description|subscribers
set -e

OUT="$(dirname "$0")/channels.raw.csv"
URLS_FILE="$(dirname "$0")/urls.tmp"

echo "Fetching sitemap..."
curl -s "https://whchannels.com/en/channel/sitemap/media.xml" | \
  grep -oE "https://whchannels.com/en/channel/[0-9]+[^<]*" > "$URLS_FILE"
TOTAL=$(wc -l < "$URLS_FILE")
echo "Total detail pages: $TOTAL"

> "$OUT"
COUNT=0
SUCCESS=0
while IFS= read -r url; do
  COUNT=$((COUNT+1))
  # 下载详情页 html · 提取
  HTML=$(curl -s --max-time 10 "$url" || true)
  # 提取 whatsapp.com/channel/0029Va... 真 invite code (允许 0029Vb 等变体)
  WA_URL=$(echo "$HTML" | grep -oE "whatsapp\\.com/channel/[A-Za-z0-9_-]{20,}" | head -1)
  if [ -z "$WA_URL" ]; then continue; fi
  INVITE=$(echo "$WA_URL" | sed 's|.*channel/||')
  # 提取 channel 名 (og:title 或 h1)
  NAME=$(echo "$HTML" | grep -oE '<meta property="og:title" content="[^"]+"' | head -1 | sed 's/.*content="//; s/" *$//; s/"//g' | sed 's/|/_/g' | head -c 100)
  # 提取 description (og:description)
  DESC=$(echo "$HTML" | grep -oE '<meta property="og:description" content="[^"]+"' | head -1 | sed 's/.*content="//; s/" *$//; s/"//g; s/|/_/g' | head -c 200)
  # 提取 tags (从 URL slug + page 里的 tag chip)
  TAGS=$(echo "$HTML" | grep -oE 'href="/en/channel/tag/[a-z-]+"' | sed 's|.*tag/||; s|".*||' | sort -u | tr '\n' '|' | sed 's/|$//')
  # 提取订阅数 (如果有)
  SUBS=$(echo "$HTML" | grep -oE '[0-9,]+ [Ss]ubscribers' | head -1 | grep -oE '[0-9,]+' | tr -d ',')
  # 写 CSV
  printf "%s|%s|%s|%s|%s\n" "$NAME" "$INVITE" "$TAGS" "$DESC" "$SUBS" >> "$OUT"
  SUCCESS=$((SUCCESS+1))
  if [ $((COUNT % 20)) -eq 0 ]; then
    echo "  progress $COUNT/$TOTAL · success=$SUCCESS"
  fi
done < "$URLS_FILE"

echo "==== DONE ===="
echo "Total fetched: $COUNT"
echo "With valid invite: $SUCCESS"
echo "Output: $OUT"
rm -f "$URLS_FILE"
