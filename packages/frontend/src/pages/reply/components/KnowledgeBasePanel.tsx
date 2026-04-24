// 2026-04-24 · 知识库管理 (左列表 · 右详情)
import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Card,
  Dropdown,
  Empty,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  BookOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  PlusOutlined,
  StarFilled,
} from '@ant-design/icons';
import {
  kbApi,
  type KnowledgeBase,
  type KbStats,
} from '@/lib/intelligent-reply-api';
import { extractErrorMessage } from '@/lib/api';
import { KbDetailPane } from './KbDetailPane';
import { KbCreateModal } from './KbCreateModal';

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';

interface Props {
  kbs: KnowledgeBase[];
  activeKbId: number | null;
  onSelectKb: (id: number) => void;
  onChange: () => void;
  defaultKbId: number | null;
  onSetDefault: (id: number) => void;
}

export function KnowledgeBasePanel({
  kbs,
  activeKbId,
  onSelectKb,
  onChange,
  defaultKbId,
  onSetDefault,
}: Props) {
  const { message, modal } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [statsMap, setStatsMap] = useState<Map<number, KbStats>>(new Map());

  useEffect(() => {
    // 一次性拉所有 KB 的统计
    void (async () => {
      const map = new Map<number, KbStats>();
      for (const kb of kbs) {
        try {
          const s = await kbApi.stats(kb.id);
          map.set(kb.id, s);
        } catch {
          // 忽略
        }
      }
      setStatsMap(map);
    })();
  }, [kbs]);

  const activeKb = kbs.find((k) => k.id === activeKbId) ?? null;

  const handleDelete = async (id: number) => {
    try {
      await kbApi.remove(id);
      message.success('已删除');
      onChange();
    } catch (err) {
      message.error(extractErrorMessage(err, '删除失败'));
    }
  };

  return (
    <div style={{ display: 'flex', gap: 16, minHeight: 480 }}>
      {/* 左列 · KB 列表 */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setCreateOpen(true)}
            block
            style={{ background: BRAND, borderColor: BRAND }}
          >
            新建知识库
          </Button>
          {kbs.length === 0 ? (
            <Empty description="还没有知识库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            kbs.map((kb) => {
              const selected = kb.id === activeKbId;
              const isDefault = kb.id === defaultKbId;
              const stats = statsMap.get(kb.id);
              return (
                <div
                  key={kb.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectKb(kb.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSelectKb(kb.id);
                  }}
                  style={{
                    padding: '12px 14px',
                    border: selected ? `2px solid ${BRAND}` : '1px solid #e0e0e0',
                    background: selected ? BRAND_SOFT : '#fff',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: selected ? BRAND : '#f5f5f5',
                        color: selected ? '#fff' : '#8c8c8c',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      <BookOutlined />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          color: selected ? BRAND : '#333',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {kb.name}
                        {isDefault && <StarFilled style={{ color: '#faad14', marginLeft: 4 }} />}
                      </div>
                      <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                        {stats ? (
                          <>
                            {stats.sources} 文档 · {stats.faqEnabled} FAQ
                            {stats.faqDraft > 0 && (
                              <Tag
                                color="warning"
                                style={{ marginLeft: 4, fontSize: 10, padding: '0 4px' }}
                              >
                                {stats.faqDraft} 待审
                              </Tag>
                            )}
                          </>
                        ) : (
                          '...'
                        )}
                      </div>
                    </div>
                    <Dropdown
                      menu={{
                        items: [
                          {
                            key: 'default',
                            icon: <CheckCircleOutlined />,
                            label: isDefault ? '已是默认' : '设为默认',
                            disabled: isDefault,
                            onClick: () => onSetDefault(kb.id),
                          },
                          { type: 'divider' },
                          {
                            key: 'del',
                            danger: true,
                            icon: <DeleteOutlined />,
                            label: (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  modal.confirm({
                                    title: `删除 "${kb.name}"?`,
                                    content: '文档 · FAQ · 保留实体 · 客户对话绑定都会一起删',
                                    okType: 'danger',
                                    onOk: () => handleDelete(kb.id),
                                  });
                                }}
                              >
                                删除
                              </span>
                            ),
                          },
                        ],
                      }}
                      trigger={['click']}
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<EllipsisOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Dropdown>
                  </div>
                </div>
              );
            })
          )}
        </Space>
      </div>

      {/* 右列 · 详情 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {activeKb ? (
          <KbDetailPane
            kb={activeKb}
            stats={statsMap.get(activeKb.id)}
            onChange={onChange}
            isDefault={activeKb.id === defaultKbId}
            onSetDefault={() => onSetDefault(activeKb.id)}
          />
        ) : (
          <Card>
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Typography.Text type="secondary">
                请选择一个知识库, 或新建
              </Typography.Text>
            </div>
          </Card>
        )}
      </div>

      {/* 新建 Modal */}
      <KbCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(kb) => {
          setCreateOpen(false);
          onSelectKb(kb.id);
          onChange();
        }}
      />
    </div>
  );
}
