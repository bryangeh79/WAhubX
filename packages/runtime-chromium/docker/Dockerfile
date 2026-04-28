# 2026-04-25 · Chromium per-slot runtime container image
# D9 改造: build context = monorepo root · 支持 @wahubx/shared workspace 依赖
# Multi-stage: builder (装 dev deps + tsc shared + runtime) → final (仅 prod deps + dist)
# Base: Debian 12 (bookworm) + Node 20 + 系统 chromium

# ═══ Stage 1 · builder ════════════════════════════════════════
FROM node:20-bookworm-slim AS builder
WORKDIR /build

# 装 pnpm (monorepo 工作区解析需要)
RUN npm install -g pnpm@9 2>&1 | tail -3

# 拷整个 monorepo (只 runtime-chromium + shared 用 · 但 pnpm-workspace.yaml 在 root)
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY packages/shared ./packages/shared
COPY packages/runtime-chromium/package.json ./packages/runtime-chromium/
COPY packages/runtime-chromium/tsconfig.json ./packages/runtime-chromium/

# 装 deps (workspace 自动解析 @wahubx/shared)
# --filter 缩小 install 范围 · 不装 backend/frontend
RUN pnpm install --frozen-lockfile --filter @wahubx/runtime-chromium... 2>&1 | tail -5

# 拷源码 + build (shared 先 build 出 dist · runtime tsc 才能找到 .d.ts)
COPY packages/shared/src ./packages/shared/src
COPY packages/runtime-chromium/src ./packages/runtime-chromium/src
RUN pnpm --filter @wahubx/shared build 2>&1 | tail -3
RUN pnpm --filter @wahubx/runtime-chromium exec tsc 2>&1 | tail -3

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

# 装 pnpm 给 prod install
RUN npm install -g pnpm@9 2>&1 | tail -3

# 应用层
WORKDIR /app

# 拷必要的 prod 文件: workspace 配置 + shared dist + runtime package + dist
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY --from=builder /build/packages/shared/package.json ./packages/shared/
COPY --from=builder /build/packages/shared/dist ./packages/shared/dist
COPY --from=builder /build/packages/runtime-chromium/package.json ./packages/runtime-chromium/
COPY --from=builder /build/packages/runtime-chromium/dist ./packages/runtime-chromium/dist

# 装 prod deps · 不带 dev (typescript 等)
RUN pnpm install --prod --frozen-lockfile --filter @wahubx/runtime-chromium... 2>&1 | tail -5

# init script
COPY packages/runtime-chromium/docker/init.sh /usr/local/bin/init.sh
RUN chmod +x /usr/local/bin/init.sh

# Puppeteer 配置: 用系统 chromium · 不下载
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# 生产环境 · pino 走默认 JSON · 不依赖 pino-pretty (devDep)
ENV NODE_ENV=production

# 工作目录指到 runtime-chromium 子包 · 让 node 解析 @wahubx/shared 时找得到
WORKDIR /app/packages/runtime-chromium

# 运行时 user-data-dir 挂载点
VOLUME ["/app/wa-data"]

# 健康检查端口 (runtime 内 WS client 连控制面 · 暂未用)
EXPOSE 9701

# 用 dumb-init 接管 PID 1 · graceful shutdown 给 SIGTERM 转发
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/usr/local/bin/init.sh"]
