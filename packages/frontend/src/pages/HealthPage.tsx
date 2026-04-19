import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Spin, Tag } from 'antd';
import { api } from '@/lib/api';

interface HealthResponse {
  status: string;
  service: string;
  version: string;
  uptime_sec: number;
  timestamp: string;
}

export function HealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<HealthResponse>('/health');
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card
      title="系统健康"
      extra={
        <Button onClick={() => void load()} loading={loading}>
          重新检查
        </Button>
      }
      style={{ maxWidth: 720, margin: '0 auto' }}
    >
      {loading && !data && <Spin />}
      {error && <Alert type="error" message="后端连接失败" description={error} showIcon />}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Tag color={data.status === 'ok' ? 'success' : 'error'} style={{ fontSize: 14 }}>
            {data.status.toUpperCase()}
          </Tag>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="服务">{data.service}</Descriptions.Item>
            <Descriptions.Item label="版本">{data.version}</Descriptions.Item>
            <Descriptions.Item label="在线时长">{data.uptime_sec} 秒</Descriptions.Item>
            <Descriptions.Item label="服务器时间">{data.timestamp}</Descriptions.Item>
          </Descriptions>
        </Space>
      )}
    </Card>
  );
}
