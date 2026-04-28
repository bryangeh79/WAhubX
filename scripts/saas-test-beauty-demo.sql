-- 2026-04-29 · SaaS 边界验证测试数据
-- Beauty Demo Tenant (美容业 · 跟 WAhubX 完全无关)
-- 验证: AI 客服板块在跨行业租户场景下不出现 WAhubX/账号系统偏见

BEGIN;

-- ─── Step 1 · 建 Beauty Demo Tenant ─────────────────────────────────
-- 注: 用 ON CONFLICT 让重复执行幂等
INSERT INTO tenant (id, name, email, plan, slot_limit, status, country)
VALUES (99, 'Beauty Demo Tenant', 'beauty@demo.test', 'pro', 30, 'active', 'MY')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ─── Step 2 · 建 4 个 KB ────────────────────────────────────────────
-- 公司通用 (default)
INSERT INTO knowledge_base (id, tenant_id, name, description, goal_prompt, is_default, status)
VALUES
  (200, 99, '公司通用', 'Beauty Demo 公司通用客服话术', '让客户了解我们的美容服务并预约', true, 1),
  (201, 99, '美白护理配套', '专业美白护理 · 8 次疗程显著见效', '让客户了解美白配套并预约咨询', false, 1),
  (202, 99, '祛痘护理配套', '深层清洁 + 抗炎 + 修复三步法', '让客户了解祛痘配套并预约咨询', false, 1),
  (203, 99, '身体塑形课程', '私教 1 对 1 形体管理 · 12 周课程', '让客户了解塑形课程并预约咨询', false, 1)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- ─── Step 3 · 注: chunks 需要先建 knowledge_base_source 记录, 本轮 SaaS 边界验证
--               主要测 FAQ + 菜单路径 (不依赖 chunks/RAG), 跳过 chunks 灌
--               真实 LLM 端到端测试需要 Beauty Demo 客服号扫码登录, 当前测试不覆盖

-- ─── Step 4 · 灌通用 starter FAQ 到 KB 200 (模拟 migration 1798) ─────
-- 简化版 · 灌 6 条最关键 starter (够测 8 个测试案例)
INSERT INTO knowledge_base_faq (kb_id, question, answer, tags, status, source, hit_count)
VALUES
  (200, '你好', '你好呀！欢迎来到我们公司～请问有什么我可以帮您的吗？', ARRAY['intent:greeting', 'risk:low', 'var:您好', 'var:嗨', 'var:在吗', 'greeting', 'zh'], 'enabled', 'manual_bulk', 0),
  (200, '介绍一下', '请问您想了解哪一项服务呢？我们这边主要提供几个不同的项目，您可以告诉我您的需求～', ARRAY['intent:product_intro', 'risk:low', 'fu:您具体想了解哪方面?', 'var:有什么服务', 'var:你们卖什么', 'var:什么产品', 'product_intro', 'zh'], 'enabled', 'manual_bulk', 0),
  (200, '多少钱', '请问您想了解哪一项服务的价格呢？告诉我具体项目，我可以让顾问帮您查报价 😊', ARRAY['intent:pricing', 'handoff:if_no_price', 'risk:medium', 'fu:您具体想了解哪个项目?', 'var:报价', 'var:价钱', 'var:价格', 'pricing', 'zh'], 'enabled', 'manual_bulk', 0),
  (200, '人工', '好的，正在为您转接真人客服...', ARRAY['intent:human_agent', 'handoff:always', 'risk:low', 'var:转人工', 'var:真人', 'var:客服', 'handoff', 'zh'], 'enabled', 'manual_bulk', 0),
  (200, '怎么预约', '您可以告诉我想预约哪个项目和大概的时间，我帮您转给顾问安排 😊', ARRAY['intent:demo', 'handoff:always', 'risk:low', 'fu:您想预约哪个项目?', 'var:可以预约吗', 'var:怎么约', 'var:预约', 'appointment', 'zh'], 'enabled', 'manual_bulk', 0),
  (200, '你吃饭了吗', '哈哈，我主要负责产品咨询的智能客服 😊 您是想了解我们的服务、价格、预约流程，还是需要我帮您转人工呢？', ARRAY['intent:off_topic', 'risk:low', 'var:吃饭了吗', 'var:在干嘛', 'off_topic', 'zh'], 'enabled', 'manual_bulk', 0)
ON CONFLICT DO NOTHING;

-- ─── Step 5 · 灌产品 KB 各 2-3 条 FAQ ─────────────────────────────────
INSERT INTO knowledge_base_faq (kb_id, question, answer, tags, status, source, hit_count)
VALUES
  -- KB 201 美白护理
  (201, '美白几次能见效', '通常 3-4 次能看到明显变化 · 完整 8 次后稳定 ✨ 建议先来做一次免费皮肤检测，顾问会根据您的情况给具体建议哦', ARRAY['intent:product_intro', 'risk:low', 'fu:您想先约皮肤检测吗?', 'var:几次能白', 'var:多久能白', 'var:见效要多久', 'whitening', 'zh'], 'enabled', 'ai_generated', 0),
  (201, '美白会反弹吗', '只要做好日常防晒，效果一般可以维持 6-12 个月 · 我们也会给您日常护肤建议', ARRAY['intent:product_intro', 'risk:low', 'fu:您想先了解日常护理建议吗?', 'var:反弹吗', 'var:能维持多久', 'whitening', 'zh'], 'enabled', 'ai_generated', 0),
  -- KB 202 祛痘护理
  (202, '祛痘会留疤吗', '规范操作不会留疤的 · 我们用一次性器械 · 治疗过程中会做好抗菌处理 😊 您的痘痘大概是炎症型还是粉刺型呢?', ARRAY['intent:risk', 'risk:medium', 'fu:您的痘痘大概是炎症型还是粉刺型?', 'var:会留疤吗', 'var:有疤痕吗', 'acne', 'zh'], 'enabled', 'ai_generated', 0),
  (202, '祛痘多久见效', '一般 2-3 次能看到炎症消退，6 次完整疗程后皮肤明显改善 · 也要配合日常护肤和饮食～', ARRAY['intent:product_intro', 'risk:low', 'fu:您要不要先约皮肤检测?', 'var:几次见效', 'var:多久能好', 'acne', 'zh'], 'enabled', 'ai_generated', 0),
  -- KB 203 身体塑形
  (203, '塑形课多久一次', '一般每周 2-3 次 · 每次 60-90 分钟 · 12 周完整课程共 24-36 节 · 周末班/晚班都有', ARRAY['intent:setup', 'risk:low', 'fu:您方便周末还是晚上呢?', 'var:每周几次', 'var:课程多长', 'fitness', 'zh'], 'enabled', 'ai_generated', 0),
  (203, '没运动基础能做吗', '完全可以哦 😊 所有课程都是从零基础起步设计的 · 教练会根据您的体能调整强度', ARRAY['intent:product_intro', 'risk:low', 'fu:您之前有运动经验吗?', 'var:零基础', 'var:没运动过', 'fitness', 'zh'], 'enabled', 'ai_generated', 0)
ON CONFLICT DO NOTHING;

-- ─── Step 6 · tenant_reply_settings 设 default_kb_id=200 + smart 模式 ─
INSERT INTO tenant_reply_settings (tenant_id, mode, default_kb_id, daily_ai_reply_limit, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, blacklist_keywords, custom_handoff_keywords)
VALUES (99, 'smart', 200, 200, false, '22:00', '08:00', '{}', '{}')
ON CONFLICT (tenant_id) DO UPDATE SET default_kb_id = 200, mode = 'smart';

COMMIT;

-- ─── 验证查询 ───────────────────────────────────────────────────────
\echo '=== Beauty Demo Tenant KB pool ==='
SELECT id, name, is_default, status FROM knowledge_base WHERE tenant_id = 99 ORDER BY id;

\echo '=== KB chunks ==='
SELECT kb_id, COUNT(*) as chunk_count FROM knowledge_base_chunk WHERE kb_id IN (200, 201, 202, 203) GROUP BY kb_id ORDER BY kb_id;

\echo '=== KB FAQs ==='
SELECT kb_id, COUNT(*) as faq_count FROM knowledge_base_faq WHERE kb_id IN (200, 201, 202, 203) GROUP BY kb_id ORDER BY kb_id;

\echo '=== tenant_reply_settings ==='
SELECT tenant_id, mode, default_kb_id FROM tenant_reply_settings WHERE tenant_id = 99;

\echo '=== SaaS 隔离验证 · tenant 5 (WAhubX) vs tenant 99 (Beauty) KB 完全独立 ==='
SELECT tenant_id, COUNT(*) as kb_count, array_agg(name ORDER BY id) as names FROM knowledge_base WHERE tenant_id IN (5, 99) GROUP BY tenant_id ORDER BY tenant_id;
