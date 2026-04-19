import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Empty,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, extractErrorMessage } from '@/lib/api';

const { Text, Paragraph } = Typography;

interface ScriptPack {
  id: number;
  packId: string;
  name: string;
  version: string;
  language: string;
  country: string[];
  author: string | null;
  description: string | null;
  enabled: boolean;
  installedAt: string;
  assetPoolsRequired: string[];
}

interface Script {
  id: number;
  packId: number;
  scriptId: string;
  name: string;
  category: string;
  totalTurns: number;
  minWarmupStage: number;
  aiRewrite: boolean;
  content: Record<string, unknown>;
}

export function ScriptsTab() {
  const [packs, setPacks] = useState<ScriptPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ScriptPack[]>('/script-packs');
      setPacks(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载剧本包失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const importBundled = async () => {
    setImporting(true);
    try {
      const res = await api.post<{ imported: string[]; skipped: string[] }>(
        '/script-packs/import-bundled',
      );
      antdMessage.success(`导入 ${res.data.imported.length} 个文件, 跳过 ${res.data.skipped.length}`);
      await load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '导入失败'));
    } finally {
      setImporting(false);
    }
  };

  const toggle = async (pack: ScriptPack, enabled: boolean) => {
    try {
      await api.patch(`/script-packs/${pack.id}/toggle`, { enabled });
      await load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '切换失败'));
    }
  };

  const remove = async (pack: ScriptPack) => {
    try {
      await api.delete(`/script-packs/${pack.id}`);
      antdMessage.success(`已删除 ${pack.packId}`);
      await load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '删除失败'));
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {error && <Alert type="error" message={error} showIcon />}
      <Card
        size="small"
        title={`剧本包 (${packs.length})`}
        extra={
          <Space>
            <Button onClick={load} loading={loading} size="small">刷新</Button>
            <Button type="primary" size="small" onClick={importBundled} loading={importing}>
              导入仓库自带包 (scripts/)
            </Button>
          </Space>
        }
      >
        {packs.length === 0 ? (
          <Empty description={'尚无剧本包 — 点右上「导入仓库自带包」灌入官方 100 剧本'} />
        ) : (
          <Collapse>
            {packs.map((p) => <PackPanel key={p.id} pack={p} onToggle={toggle} onRemove={remove} />)}
          </Collapse>
        )}
      </Card>
    </Space>
  );
}

function PackPanel({
  pack,
  onToggle,
  onRemove,
}: {
  pack: ScriptPack;
  onToggle: (p: ScriptPack, e: boolean) => Promise<void>;
  onRemove: (p: ScriptPack) => Promise<void>;
}) {
  const [scripts, setScripts] = useState<Script[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [previewing, setPreviewing] = useState<Script | null>(null);

  const loadScripts = useCallback(async () => {
    if (loaded) return;
    try {
      const res = await api.get<Script[]>(`/script-packs/${pack.id}/scripts`);
      setScripts(res.data);
      setLoaded(true);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '加载剧本列表失败'));
    }
  }, [pack.id, loaded]);

  const cols: ColumnsType<Script> = [
    { title: 'script_id', dataIndex: 'scriptId', render: (v) => <Text code>{v}</Text> },
    { title: '名称', dataIndex: 'name' },
    { title: '分类', dataIndex: 'category', render: (c) => <Tag color="cyan">{c}</Tag> },
    { title: 'turns', dataIndex: 'totalTurns', width: 70, align: 'center' },
    {
      title: 'stage≥',
      dataIndex: 'minWarmupStage',
      width: 80,
      align: 'center',
      render: (s) => <Text type="secondary">{s}</Text>,
    },
    {
      title: 'AI改写',
      dataIndex: 'aiRewrite',
      width: 80,
      render: (a) => (a ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '',
      width: 80,
      render: (_, r) => (
        <Button size="small" type="link" onClick={() => setPreviewing(r)}>
          预览 JSON
        </Button>
      ),
    },
  ];

  return (
    <Collapse.Panel
      key={pack.id}
      header={
        <Space>
          <Badge status={pack.enabled ? 'success' : 'default'} />
          <Text strong>{pack.name}</Text>
          <Tag>{pack.packId}</Tag>
          <Text type="secondary">v{pack.version}</Text>
          <Tag color="blue">{pack.language}</Tag>
          <Tag>{pack.country.join(',')}</Tag>
        </Space>
      }
      extra={
        <Space onClick={(e) => e.stopPropagation()}>
          <Switch
            size="small"
            checked={pack.enabled}
            onChange={(v) => void onToggle(pack, v)}
            checkedChildren="启用"
            unCheckedChildren="禁用"
          />
          <Popconfirm
            title={`确认删除 ${pack.packId} ?`}
            description="CASCADE 会带走所有剧本"
            okText="删"
            okButtonProps={{ danger: true }}
            onConfirm={() => void onRemove(pack)}
          >
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {pack.description && <Paragraph type="secondary">{pack.description}</Paragraph>}
        {pack.author && <Text type="secondary" style={{ fontSize: 12 }}>作者: {pack.author}</Text>}
        <Text type="secondary" style={{ fontSize: 12 }}>
          需要资源池: {pack.assetPoolsRequired.length > 0 ? pack.assetPoolsRequired.join(', ') : '无'}
        </Text>
        <Button size="small" onClick={() => void loadScripts()}>
          {loaded ? '已加载' : '加载剧本列表'}
        </Button>
        {scripts && (
          <Table
            size="small"
            rowKey="id"
            dataSource={scripts}
            columns={cols}
            pagination={{ pageSize: 10 }}
          />
        )}
      </Space>
      <Modal
        title={previewing ? `预览: ${previewing.name}` : ''}
        open={!!previewing}
        onCancel={() => setPreviewing(null)}
        footer={null}
        width={720}
      >
        {previewing && (
          <pre style={{ maxHeight: 500, overflow: 'auto', fontSize: 11 }}>
            {JSON.stringify(previewing.content, null, 2)}
          </pre>
        )}
      </Modal>
    </Collapse.Panel>
  );
}
