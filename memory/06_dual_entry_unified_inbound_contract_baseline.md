# 06 Dual Entry Unified Inbound Contract Baseline

## 基线说明

- 当前尚未完成 Chromium inbound 正式主链路
- 现阶段先记录统一入口原则，避免后续接入时分叉

## 统一入口原则

1. runtime 侧是唯一消息来源
2. backend 侧统一接收 `message-upsert` 事件
3. DB 是 takeover / auto-reply / intelligent-reply 的统一读取面
4. 不允许多个模块直接各自监听浏览器 DOM 做业务决策

## 待完成

- Chromium inbound observer 主路径
- 去重策略
- DB 落库标准结构
- 上层模块统一消费契约
