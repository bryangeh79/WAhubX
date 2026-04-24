// 2026-04-21 · 顶级 tab "接管" · 原 Admin 里的 TakeoverTab 提出来独立
import { Typography } from 'antd';
import { TakeoverTab } from './admin/TakeoverTab';

const { Title, Text } = Typography;

export function TakeoverPage() {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>人工接管</Title>
        <Text type="secondary">AI 搞不定的对话转人工 · 手动跟客户聊</Text>
      </div>
      <TakeoverTab />
    </div>
  );
}
