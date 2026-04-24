// 2026-04-24 · 保留实体 · 只读为主 (系统自动抽)
import { useEffect, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { kbApi, type KbProtectedEntity } from '@/lib/intelligent-reply-api';
import { extractErrorMessage } from '@/lib/api';

const BRAND = '#25d366';

interface Props {
  kbId: number;
  onChanged: () => void;
}

export function KbProtectedTab({ kbId, onChanged }: Props) {
  const { message } = App.useApp();
  const [list, setList] = useState<KbProtectedEntity[]>([]);
  const [loading, setLoading] = useState(false);
  const [newType, setNewType] = useState<'phone' | 'email' | 'url' | 'company' | 'address'>('phone');
  const [newValue, setNewValue] = useState('');

  const reload = async () => {
    setLoading(true);
    try {
      setList(await kbApi.listProtected(kbId));
    } catch (err) {
      message.error(extractErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId]);

  const handleAdd = async () => {
    if (!newValue.trim()) return;
    try {
      await kbApi.addProtected(kbId, { entityType: newType, value: newValue.trim() });
      message.success('已添加');
      setNewValue('');
      await reload();
      onChanged();
    } catch (err) {
      message.error(extractErrorMessage(err, '添加失败'));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await kbApi.removeProtected(kbId, id);
      message.success('已删除');
      await reload();
      onChanged();
    } catch (err) {
      message.error(extractErrorMessage(err, '删除失败'));
    }
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="AI 回复保留这些实体不改"
        description="上传文档时系统自动抽取电话/邮箱/网址. 当 AI 生成回复提及这些实体时必须原样保留, 不能篡改."
      />

      <Space.Compact style={{ width: '100%', maxWidth: 600 }}>
        <Select
          value={newType}
          onChange={setNewType}
          style={{ width: 100 }}
          options={[
            { value: 'phone', label: '电话' },
            { value: 'email', label: '邮箱' },
            { value: 'url', label: '网址' },
            { value: 'company', label: '公司' },
            { value: 'address', label: '地址' },
          ]}
        />
        <Input
          placeholder="例: 60123456789 / sales@example.com"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onPressEnter={handleAdd}
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
          style={{ background: BRAND, borderColor: BRAND }}
        >
          手动添加
        </Button>
      </Space.Compact>

      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={list}
        pagination={false}
        columns={[
          {
            title: '类型',
            dataIndex: 'entityType',
            width: 90,
            render: (v: string) =>
              v === 'phone' ? (
                <Tag color="blue">电话</Tag>
              ) : v === 'email' ? (
                <Tag color="purple">邮箱</Tag>
              ) : v === 'url' ? (
                <Tag color="geekblue">网址</Tag>
              ) : v === 'company' ? (
                <Tag color="green">公司</Tag>
              ) : (
                <Tag>{v}</Tag>
              ),
          },
          {
            title: '值',
            dataIndex: 'value',
          },
          {
            title: '操作',
            width: 80,
            render: (_: unknown, row: KbProtectedEntity) => (
              <Popconfirm title="删除?" onConfirm={() => handleDelete(row.id)}>
                <Button type="link" danger size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          },
        ]}
        locale={{
          emptyText: (
            <div style={{ padding: 24 }}>
              <Typography.Text type="secondary">
                还没有保留实体 · 上传文档后系统会自动抽取
              </Typography.Text>
            </div>
          ),
        }}
      />
    </Space>
  );
}
