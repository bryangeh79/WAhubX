# 07 Unified Inbound Intent Dispatch Skeleton

## 目标

为后续 Chromium runtime 的 inbound 消息建立统一 intent dispatch 骨架。

## 草骨架

1. Runtime 收到 inbound
2. RuntimeBridgeService 转成 backend 标准事件
3. Message persistence 落库
4. Intent dispatcher 判定:
   - takeover
   - intelligent-reply
   - auto-reply
   - 其他系统模块
5. Dispatcher 再决定是否回复、转人工或仅记录

## 当前状态

- 仅建立记忆骨架
- 真正实现尚未开始
