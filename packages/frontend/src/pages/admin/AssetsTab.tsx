// M7 Day 6 · AssetsTab · persona 库 + asset 管理
//
// 功能:
//   - 列 persona (from /assets/personas)
//   - 选 persona 后列该 persona 的 asset · 按 kind 筛
//   - 生成 persona (调 /assets/generate-persona · count 1-20)
//   - 上传 asset (form-data · /assets/upload)
//   - 删除 asset (/assets/:id DELETE)
//   - 配额显示 (/assets/quota/:personaId)
//
// 0 UT (per sketch)

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message as antdMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, extractErrorMessage } from '@/lib/api';

const { Text, Paragraph } = Typography;

interface PersonaRow {
  personaId: string;
  displayName: string;
  waNickname: string;
  ethnicity: string;
  country: string;
  source: string;
  createdAt: string;
}

interface AssetRow {
  id: number;
  poolName: string;
  kind: 'voice' | 'image' | 'file' | 'sticker';
  filePath: string;
  source: string;
  personaId: string | null;
  createdAt: string;
}

interface QuotaInfo {
  personaId: string;
  images: { used: number; limit: number };
  voices: { used: number; limit: number };
}

interface GenReport {
  requested: number;
  parsed: number;
  rejectedLeakage: number;
  rejectedSchema: number;
  savedIds: string[];
  aiProviderUsed: string | null;
}

export function AssetsTab() {
  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [kindFilter, setKindFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [genCount, setGenCount] = useState(5);
  const [genRunning, setGenRunning] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState<string>('image');
  const [uploadPool, setUploadPool] = useState<string>('');

  const loadPersonas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<PersonaRow[]>('/assets/personas');
      setPersonas(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载 persona 失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAssets = useCallback(async () => {
    if (!selectedPersona) {
      setAssets([]);
      setQuota(null);
      return;
    }
    try {
      const params: Record<string, string> = { personaId: selectedPersona };
      if (kindFilter) params.kind = kindFilter;
      const [aRes, qRes] = await Promise.all([
        api.get<AssetRow[]>('/assets/list', { params }),
        api.get<QuotaInfo>(`/assets/quota/${selectedPersona}`),
      ]);
      setAssets(aRes.data);
      setQuota(qRes.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载 asset 失败'));
    }
  }, [selectedPersona, kindFilter]);

  useEffect(() => {
    void loadPersonas();
  }, [loadPersonas]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const handleGenerate = async () => {
    setGenRunning(true);
    try {
      const res = await api.post<GenReport>('/assets/generate-persona', {
        count: genCount,
        ethnicity: 'chinese-malaysian',
      });
      antdMessage.success(
        `persona 生成 · parsed=${res.data.parsed} · saved=${res.data.savedIds.length}`,
      );
      setGenOpen(false);
      await loadPersonas();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '生成失败'));
    } finally {
      setGenRunning(false);
    }
  };

  const handleDeleteAsset = async (id: number) => {
    try {
      await api.delete(`/assets/${id}`);
      antdMessage.success('删除成功');
      await loadAssets();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '删除失败'));
    }
  };

  const handleUpload = async (file: File) => {
    if (!uploadPool.trim()) {
      antdMessage.warning('需填 poolName');
      return false;
    }
    const form = new FormData();
    form.append('file', file);
    form.append('kind', uploadKind);
    form.append('poolName', uploadPool);
    if (selectedPersona) form.append('personaId', selectedPersona);
    try {
      await api.post('/assets/upload', form);
      antdMessage.success(`上传成功 · ${file.name}`);
      setUploadOpen(false);
      await loadAssets();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '上传失败'));
    }
    return false; // 阻止 antd 自动上传
  };

  const personaColumns: ColumnsType<PersonaRow> = [
    { title: 'ID', dataIndex: 'personaId', width: 200 },
    { title: '展示名', dataIndex: 'displayName' },
    { title: 'WA 昵称', dataIndex: 'waNickname' },
    {
      title: 'ethnicity',
      dataIndex: 'ethnicity',
      render: (v: string) => <Tag color="green">{v}</Tag>,
    },
    { title: '国家', dataIndex: 'country', width: 60 },
    {
      title: 'source',
      dataIndex: 'source',
      render: (v: string) => <Tag>{v}</Tag>,
    },
  ];

  const assetColumns: ColumnsType<AssetRow> = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: 'kind',
      dataIndex: 'kind',
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    { title: 'poolName', dataIndex: 'poolName' },
    { title: '文件路径', dataIndex: 'filePath', ellipsis: true },
    {
      title: 'source',
      dataIndex: 'source',
      render: (v: string) => <Tag color={v === 'manual_upload' ? 'orange' : 'default'}>{v}</Tag>,
    },
    {
      title: '操作',
      width: 100,
      render: (_: unknown, row) => (
        <Popconfirm
          title="确认删除?"
          okText="删"
          cancelText="取消"
          onConfirm={() => handleDeleteAsset(row.id)}
        >
          <Button size="small" danger>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} /> : null}

      <Card
        title="Persona 库"
        extra={
          <Space>
            <Button onClick={() => void loadPersonas()}>
              刷新
            </Button>
            <Button
              type="primary"
onClick={() => setGenOpen(true)}
            >
              AI 生成
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary">
          当前 {personas.length} 条 · 目标维持 ≥ 20 · 04:00 自动补
        </Paragraph>
        <Table
          rowKey="personaId"
          size="small"
          columns={personaColumns}
          dataSource={personas}
          loading={loading}
          pagination={{ pageSize: 10 }}
          rowSelection={{
            type: 'radio',
            selectedRowKeys: selectedPersona ? [selectedPersona] : [],
            onChange: (keys) => setSelectedPersona((keys[0] as string) ?? null),
          }}
          locale={{ emptyText: <Empty description="暂无 persona · 点 AI 生成" /> }}
        />
      </Card>

      <Card
        title={selectedPersona ? `Asset · ${selectedPersona}` : 'Asset · 请先选 persona'}
        extra={
          <Space>
            <Select
              allowClear
              placeholder="kind 筛选"
              style={{ width: 120 }}
              value={kindFilter}
              onChange={setKindFilter}
              options={[
                { value: 'image', label: 'image' },
                { value: 'voice', label: 'voice' },
                { value: 'file', label: 'file' },
                { value: 'sticker', label: 'sticker' },
              ]}
            />
            <Button
disabled={!selectedPersona}
              onClick={() => setUploadOpen(true)}
            >
              上传
            </Button>
          </Space>
        }
      >
        {quota ? (
          <Space size="large" style={{ marginBottom: 12 }}>
            <div>
              <Text>图片</Text>
              <Progress
                style={{ width: 200 }}
                percent={Math.round((quota.images.used / quota.images.limit) * 100)}
                format={() => `${quota.images.used}/${quota.images.limit}`}
              />
            </div>
            <div>
              <Text>语音</Text>
              <Progress
                style={{ width: 200 }}
                percent={Math.round((quota.voices.used / quota.voices.limit) * 100)}
                format={() => `${quota.voices.used}/${quota.voices.limit}`}
              />
            </div>
          </Space>
        ) : null}
        <Table
          rowKey="id"
          size="small"
          columns={assetColumns}
          dataSource={assets}
          pagination={{ pageSize: 10 }}
          locale={{
            emptyText: selectedPersona ? <Empty description="暂无 asset" /> : '请选 persona',
          }}
        />
      </Card>

      <Modal
        title="AI 生成 persona"
        open={genOpen}
        onCancel={() => setGenOpen(false)}
        onOk={() => void handleGenerate()}
        confirmLoading={genRunning}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>数量 (1-20)</Text>
          <InputNumber min={1} max={20} value={genCount} onChange={(v) => setGenCount(v ?? 5)} />
          <Text type="secondary">仅支持 chinese-malaysian · V1 约束</Text>
        </Space>
      </Modal>

      <Modal
        title="上传 asset"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        footer={null}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <Text>kind</Text>
            <Select
              style={{ width: '100%' }}
              value={uploadKind}
              onChange={setUploadKind}
              options={[
                { value: 'image', label: 'image' },
                { value: 'voice', label: 'voice' },
                { value: 'file', label: 'file' },
                { value: 'sticker', label: 'sticker' },
              ]}
            />
          </div>
          <div>
            <Text>poolName</Text>
            <input
              style={{ width: '100%', padding: 6, border: '1px solid #d9d9d9', borderRadius: 4 }}
              placeholder="e.g. food_malaysian"
              value={uploadPool}
              onChange={(e) => setUploadPool(e.target.value)}
            />
          </div>
          <Upload.Dragger
            beforeUpload={(file) => handleUpload(file)}
            showUploadList={false}
            multiple={false}
          >
            <p className="ant-upload-text">拖文件或点此选择</p>
            <p className="ant-upload-hint">source 将标记为 manual_upload</p>
          </Upload.Dragger>
        </Space>
      </Modal>
    </Space>
  );
}
