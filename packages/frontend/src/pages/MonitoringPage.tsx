// 2026-04-21 · 顶级 tab "运营监控" · 原 Admin 里的 QueueTab 提出来独立
import { Typography } from 'antd';
import { QueueTab } from './admin/QueueTab';

const { Title, Text } = Typography;

export function MonitoringPage() {
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>运营监控</Title>
        <Text type="secondary">实时查看任务队列 · running / pending / failed</Text>
      </div>
      <QueueTab />
    </div>
  );
}
