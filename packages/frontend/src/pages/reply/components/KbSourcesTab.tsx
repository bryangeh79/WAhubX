// 2026-04-24 · KB 文档上传 + 列表
import { useEffect, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import { DeleteOutlined, FileTextOutlined, InboxOutlined } from '@ant-design/icons';
import {
  kbApi,
  replySettingsApi,
  type KbSource,
  type KbStats,
  type ReplyMode,
} from '@/lib/intelligent-reply-api';
import { extractErrorMessage } from '@/lib/api';
import { KbAutoSetupModal } from './KbAutoSetupModal';

const BRAND = '#25d366';

interface Props {
  kbId: number;
  onChanged: () => void;
}

export function KbSourcesTab({ kbId, onChanged }: Props) {
  const { message } = App.useApp();
  const [sources, setSources] = useState<KbSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [autoSetupOpen, setAutoSetupOpen] = useState(false);
  const [lastSource, setLastSource] = useState<KbSource | null>(null);
  const [statsForModal, setStatsForModal] = useState<KbStats | undefined>();
  const [currentMode, setCurrentMode] = useState<ReplyMode>('off');

  const reload = async () => {
    setLoading(true);
    try {
      setSources(await kbApi.listSources(kbId));
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

  const uploadProps: UploadProps = {
    accept: '.pdf,.docx,.txt,.md',
    showUploadList: false,
    multiple: false,
    beforeUpload: async (file) => {
      if (file.size > 20 * 1024 * 1024) {
        message.warning('文件不能超过 20 MB');
        return Upload.LIST_IGNORE;
      }
      setUploading(true);
      try {
        const uploaded = await kbApi.uploadFile(kbId, file as unknown as File);
        message.success(`已上传 ${uploaded.fileName}`);
        await reload();
        onChanged();

        // 2026-04-24 · 一键搞定: 上传后等 2 秒让 embedding 入库, 然后拉 stats + 弹一键向导
        setTimeout(async () => {
          try {
            const [stats, settings] = await Promise.all([
              kbApi.stats(kbId),
              replySettingsApi.get(),
            ]);
            setStatsForModal(stats);
            setCurrentMode(settings.mode);
            setLastSource(uploaded);
            setAutoSetupOpen(true);
          } catch {
            // 拉不到 stats 也不影响
          }
        }, 2000);
      } catch (err) {
        message.error(extractErrorMessage(err, '上传失败'));
      } finally {
        setUploading(false);
      }
      return Upload.LIST_IGNORE;
    },
  };

  const handleDelete = async (id: number) => {
    try {
      await kbApi.removeSource(kbId, id);
      message.success('已删除');
      await reload();
      onChanged();
    } catch (err) {
      message.error(extractErrorMessage(err, '删除失败'));
    }
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {/* 上传区 */}
      <Upload.Dragger {...uploadProps} disabled={uploading}>
        <p className="ant-upload-drag-icon" style={{ marginBottom: 8 }}>
          <InboxOutlined style={{ color: BRAND, fontSize: 40 }} />
        </p>
        <p style={{ fontSize: 14, fontWeight: 500 }}>
          {uploading ? '上传中...' : '拖拽文件到这里, 或点击选择'}
        </p>
        <p style={{ fontSize: 12, color: '#8c8c8c', margin: 0 }}>
          支持 PDF · Word · txt · md · 最大 20 MB
        </p>
      </Upload.Dragger>

      <Alert
        type="info"
        showIcon
        message="上传后系统自动做 4 件事"
        description="① 解析文本 ② 切分 500 字段落 ③ 做向量 (便于语义搜索) ④ 提取电话/邮箱/网址 (AI 回复时必须保留不改)"
      />

      {/* 文档列表 */}
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={sources}
        pagination={false}
        columns={[
          {
            title: '文件',
            render: (_: unknown, row: KbSource) => (
              <Space>
                <FileTextOutlined style={{ color: BRAND }} />
                <span>{row.fileName}</span>
                <Tag>{row.kind}</Tag>
              </Space>
            ),
          },
          {
            title: '大小',
            dataIndex: 'byteSize',
            width: 90,
            render: (v: number) => `${(v / 1024).toFixed(1)} KB`,
          },
          {
            title: '状态',
            width: 110,
            render: (_: unknown, row: KbSource) =>
              row.errorMsg ? (
                <Tag color="error">失败</Tag>
              ) : row.processedAt ? (
                <Tag color="success">已处理</Tag>
              ) : (
                <Tag color="processing">处理中</Tag>
              ),
          },
          {
            title: '上传时间',
            dataIndex: 'createdAt',
            width: 150,
            render: (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false }),
          },
          {
            title: '操作',
            width: 80,
            render: (_: unknown, row: KbSource) => (
              <Popconfirm
                title="删除此文档?"
                description="相关的 chunk + 保留实体会一起删"
                onConfirm={() => handleDelete(row.id)}
              >
                <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            ),
          },
        ]}
        locale={{
          emptyText: (
            <div style={{ padding: 24, color: '#999' }}>
              <Typography.Text type="secondary">还没有文档 · 拖拽上传</Typography.Text>
            </div>
          ),
        }}
      />

      {/* 一键搞定向导 · 上传成功后弹 */}
      <KbAutoSetupModal
        open={autoSetupOpen}
        kbId={kbId}
        source={lastSource}
        stats={statsForModal}
        currentMode={currentMode}
        onClose={() => {
          setAutoSetupOpen(false);
          onChanged();
        }}
        onDone={() => {
          setAutoSetupOpen(false);
          onChanged();
          void reload();
        }}
      />
    </Space>
  );
}
