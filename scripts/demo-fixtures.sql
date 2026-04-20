-- scripts/demo-fixtures.sql
-- M7 Day 8+ · E2E smoke + demo/pilot UI 展示用
--
-- 用法:
--   docker exec -i wahubx-dev-pg psql -U wahubx -d wahubx < scripts/demo-fixtures.sql
--
-- 规则:
--   - 只 INSERT · 不 DELETE / UPDATE 既有数据
--   - 用 ON CONFLICT DO NOTHING · 幂等
--   - 所有 id 前缀 "demo_" · 便于清理
--
-- 清理 (若要重置):
--   DELETE FROM persona WHERE persona_id LIKE 'demo_%';
--   DELETE FROM wa_account WHERE phone_number LIKE '9999%';
--   DELETE FROM tenant WHERE name LIKE 'Demo %';

BEGIN;

-- ── Demo Tenant ──────────────────────────────────────
INSERT INTO tenant (id, name, plan, slot_limit, status, country, created_at)
VALUES (999, 'Demo Pilot Tenant', 'pro', 30, 'active', 'MY', NOW())
ON CONFLICT (id) DO NOTHING;

-- ── Demo Users (platform + admin) ───────────────────
-- Password hash = bcrypt('Demo1234!', round=12)
-- 手动生成的 hash · 不影响生产
INSERT INTO "user" (id, tenant_id, email, username, password_hash, role, status, created_at)
VALUES
  ('demo-admin-001', 999, 'demo-admin@wahubx.local', 'demo-admin',
   '$2b$12$placeholder.hash.for.Demo1234Bang',
   'admin', 'active', NOW()),
  ('demo-operator-001', 999, 'demo-operator@wahubx.local', 'demo-operator',
   '$2b$12$placeholder.hash.for.Demo1234Bang',
   'operator', 'active', NOW())
ON CONFLICT (id) DO NOTHING;

-- ── Demo Persona (3 条马华 variants) ────────────────
-- M7 Day 7 seed 的不同 persona · 展示 AssetsTab UI
INSERT INTO persona (
  persona_id, display_name, wa_nickname, ethnicity, country,
  content, content_hash, avatar_asset_id, used_by_slot_ids, source,
  created_at, updated_at
) VALUES
  (
    'demo_persona_jasmine_pj',
    'Jasmine Chen',
    'Jas 🌸',
    'chinese-malaysian',
    'MY',
    '{"persona_id":"demo_persona_jasmine_pj","display_name":"Jasmine Chen","wa_nickname":"Jas 🌸","gender":"female","age":28,"ethnicity":"chinese-malaysian","country":"MY","city":"Petaling Jaya","occupation":"电商客服","languages":{"primary":"zh-CN","secondary":["en","ms"],"code_switching":true},"personality":["开朗","碎碎念"],"speech_habits":{"sentence_endings":["lah","lor","啦"],"common_phrases":["真的吗 la","我 kena 啦","aiyo"],"emoji_preference":["😊","🙈","😋"],"typing_style":"短句 + 偶尔错字","avg_msg_length":12},"interests":["吃 mamak","美妆 haul","K-pop"],"activity_schedule":{"timezone":"Asia/Kuala_Lumpur","wake_up":"08:30","sleep":"23:30","peak_hours":["12:00-13:30"],"work_hours":"09:30-18:30"},"avatar_prompt":"28yo Chinese Malaysian woman casual in PJ cafe","signature_candidates":["吃饱没 🍜"],"persona_lock":true}'::jsonb,
    'a1b2c3d4e5f60708',
    NULL,
    '{}',
    'demo_seed',
    NOW(), NOW()
  ),
  (
    'demo_persona_amy_kl',
    'Amy Tan',
    'Amy',
    'chinese-malaysian',
    'MY',
    '{"persona_id":"demo_persona_amy_kl","display_name":"Amy Tan","wa_nickname":"Amy","gender":"female","age":32,"ethnicity":"chinese-malaysian","country":"MY","city":"Kuala Lumpur","occupation":"美容院主","languages":{"primary":"zh-CN","secondary":["en","ms"],"code_switching":true},"personality":["精致","健谈"],"speech_habits":{"sentence_endings":["lah","leh","咯"],"common_phrases":["can can","ok lah","aiyoh"],"emoji_preference":["💅","✨","🌸"],"typing_style":"短句 + emoji 多","avg_msg_length":15},"interests":["找 cafe 打卡","Shopee 促销抢","美容 haul"],"activity_schedule":{"timezone":"Asia/Kuala_Lumpur","wake_up":"09:00","sleep":"00:00","peak_hours":["14:00-16:00","20:00-23:00"],"work_hours":"10:00-19:00"},"avatar_prompt":"32yo Chinese Malaysian woman elegant beauty salon owner","signature_candidates":["美美哒 ✨"],"persona_lock":true}'::jsonb,
    'b2c3d4e5f6071a2b',
    NULL,
    '{}',
    'demo_seed',
    NOW(), NOW()
  ),
  (
    'demo_persona_linda_penang',
    'Linda Goh',
    '林达 Linda',
    'chinese-malaysian',
    'MY',
    '{"persona_id":"demo_persona_linda_penang","display_name":"Linda Goh","wa_nickname":"林达 Linda","gender":"female","age":26,"ethnicity":"chinese-malaysian","country":"MY","city":"Penang","occupation":"奶茶店员","languages":{"primary":"zh-CN","secondary":["en","ms"],"code_switching":true},"personality":["活泼","爱聊"],"speech_habits":{"sentence_endings":["lah","leh","lor"],"common_phrases":["真的啊","吃饱没","等阵先"],"emoji_preference":["😋","🤤","🧋"],"typing_style":"活泼 + emoji","avg_msg_length":10},"interests":["吃 mamak","TikTok 刷视频","周末跑 Pasar"],"activity_schedule":{"timezone":"Asia/Kuala_Lumpur","wake_up":"09:30","sleep":"23:00","peak_hours":["13:00-15:00","21:00-23:00"],"work_hours":"11:00-20:00"},"avatar_prompt":"26yo Chinese Malaysian young woman milk tea shop Penang","signature_candidates":["喝茶 🧋"],"persona_lock":true}'::jsonb,
    'c3d4e5f6071a2b3c',
    NULL,
    '{}',
    'demo_seed',
    NOW(), NOW()
  )
ON CONFLICT (persona_id) DO NOTHING;

-- ── Demo WhatsApp Accounts (mock · 999 prefix · 不真连) ──
INSERT INTO wa_account (
  id, phone_number, country_code, timezone, primary_language,
  wa_nickname, warmup_stage, warmup_day,
  created_at, updated_at
) VALUES
  (9991, '60999900001', 'MY', 'Asia/Kuala_Lumpur', 'zh', 'Jas 🌸', 2, 5, NOW(), NOW()),
  (9992, '60999900002', 'MY', 'Asia/Kuala_Lumpur', 'zh', 'Amy', 2, 5, NOW(), NOW()),
  (9993, '60999900003', 'MY', 'Asia/Kuala_Lumpur', 'zh', '林达 Linda', 1, 3, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- ── Demo Slots (bind account to slot under tenant 999) ──
INSERT INTO account_slot (
  tenant_id, slot_index, account_id, status,
  profile_path, persona, created_at
) VALUES
  (999, 1, 9991, 'active', 'data/slots/01', NULL, NOW()),
  (999, 2, 9992, 'active', 'data/slots/02', NULL, NOW()),
  (999, 3, 9993, 'active', 'data/slots/03', NULL, NOW())
ON CONFLICT DO NOTHING;

-- ── Demo Account Health (all low risk) ──
INSERT INTO account_health (account_id, health_score, risk_level, updated_at)
VALUES
  (9991, 95, 'low', NOW()),
  (9992, 88, 'low', NOW()),
  (9993, 100, 'low', NOW())
ON CONFLICT (account_id) DO NOTHING;

COMMIT;

-- ── 验证查询 ──
SELECT 'tenant' AS t, count(*) FROM tenant WHERE id = 999
UNION ALL
SELECT 'persona', count(*) FROM persona WHERE persona_id LIKE 'demo_%'
UNION ALL
SELECT 'wa_account', count(*) FROM wa_account WHERE id BETWEEN 9991 AND 9999
UNION ALL
SELECT 'slot', count(*) FROM account_slot WHERE tenant_id = 999
UNION ALL
SELECT 'health', count(*) FROM account_health WHERE account_id BETWEEN 9991 AND 9999;
