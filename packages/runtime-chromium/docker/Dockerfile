# 2026-04-25 · Chromium per-slot runtime container image
# Multi-stage: builder (装 dev deps + tsc) → final (仅 prod deps + dist)
# Base: Debian 12 (bookworm) + Node 20 + 系统 chromium

# ═══ Stage 1 · builder ════════════════════════════════════════
FROM node:20-bookworm-slim AS builder
WORKDIR /build
COPY package.json ./
RUN npm install --no-audit --no-fund 2>&1 | tail -3
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ═══ Stage 2 · runtime ═══════════════════════════════════════
FROM node:20-bookworm-slim AS runtime

# 系统依赖: chromium + iptables (C7.3 DNS leak 工程封) + 字体 (WA Web 中文 emoji)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    iptables \
    iproute2 \
    procps \
    curl \
    dnsutils \
    ca-certificates \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

# 应用层
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund 2>&1 | tail -3
COPY --from=builder /build/dist ./dist
COPY docker/init.sh /usr/local/bin/init.sh
RUN chmod +x /usr/local/bin/init.sh

# Puppeteer 配置: 用系统 chromium · 不下载
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# 生产环境 · pino 走默认 JSON · 不依赖 pino-pretty (devDep)
ENV NODE_ENV=production

# 运行时 user-data-dir 挂载点
VOLUME ["/app/wa-data"]

# 健康检查端口 (runtime 内 WS client 连控制面 · 暂未用)
EXPOSE 9701

# 用 dumb-init 接管 PID 1 · graceful shutdown 给 SIGTERM 转发
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/usr/local/bin/init.sh"]
