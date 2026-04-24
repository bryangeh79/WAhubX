// 2026-04-24 · 客户群管理 Drawer · 完整功能版
// 功能: 列表/搜索/排序/空态 · 批量选 · 批量删 · 导出CSV · 克隆群 · 挑选联系人
//       · 引用统计 · 最后使用时间 · 好友占比条 · 成员搜索
import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Popconfirm,
  Progress,
  Radio,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  ImportOutlined,
  LeftOutlined,
  PlusOutlined,
  SearchOutlined,
  SortAscendingOutlined,
  TeamOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import {
  campaignsApi,
  customerGroupsApi,
  MemberSendStatus,
  type ActiveSlot,
  type Campaign,
  type CustomerGroup,
  type CustomerGroupMember,
} from '@/lib/campaigns-api';
import { extractErrorMessage } from '@/lib/api';
import { CustomerGroupImportModal } from './CustomerGroupImportModal';
import { ContactPickerModal } from './ContactPickerModal';
import { BRAND, BRAND_SOFT } from '../wizard/shared';

interface Props {
  open: boolean;
  onClose: () => void;
}

type SortKey = 'createdDesc' | 'createdAsc' | 'memberDesc' | 'memberAsc' | 'nameAsc' | 'usageDesc';

const SORT_LABEL: Record<SortKey, string> = {
  createdDesc: '最新创建',
  createdAsc: '最早创建',
  memberDesc: '成员数 ↓',
  memberAsc: '成员数 ↑',
  nameAsc: '名称 A→Z',
  usageDesc: '引用次数 ↓',
};

// 引用统计结构
interface Usage {
  count: number; // 被多少个 campaign 引用
  lastUsedAt: string | null; // 最近一次 campaign 创建时间
}

export function CustomerGroupDrawer({ open, onClose }: Props) {
  const { message } = App.useApp();
  const [items, setItems] = useState<CustomerGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<CustomerGroup | null>(null);
  const [members, setMembers] = useState<CustomerGroupMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importForExistingId, setImportForExistingId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // campaigns 用于算引用统计
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [slots, setSlots] = useState<ActiveSlot[]>([]);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('createdDesc');
  const [selected, setSelected] = useState<number[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberFilter, setMemberFilter] = useState<'all' | 'ok' | 'bad' | 'opted'>('all');

  const reload = async () => {
    setLoading(true);
    try {
      const [groups, cmps, slotList] = await Promise.all([
        customerGroupsApi.list(),
        campaignsApi.list().catch(() => [] as Campaign[]),
        campaignsApi.allSlots().catch(() => [] as ActiveSlot[]),
      ]);
      setItems(groups);
      setCampaigns(cmps);
      setSlots(slotList);
    } catch (err) {
      message.error(extractErrorMessage(err, '加载客户群失败'));
    } finally {
      setLoading(false);
    }
  };

  const reloadMembers = async (groupId: number) => {
    setMembersLoading(true);
    try {
      const res = await customerGroupsApi.listMembers(groupId);
      setMembers(res.items);
    } catch (err) {
      message.error(extractErrorMessage(err, '加载成员失败'));
    } finally {
      setMembersLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setActive(null);
      setSearch('');
      setSelected([]);
      setMemberSearch('');
      void reload();
    }
  }, [open]);

  useEffect(() => {
    if (active) {
      setMemberSearch('');
      void reloadMembers(active.id);
    }
  }, [active]);

  const sourceLabel = (src: number) => {
    return { 1: '联系人', 2: 'CSV', 3: '粘贴' }[src] ?? src;
  };

  // ── 引用统计计算 ─────────────────────────────
  const usageMap = useMemo(() => {
    const m = new Map<number, Usage>();
    for (const c of campaigns) {
      const gids = c.targets?.groupIds ?? [];
      for (const gid of gids) {
        const prev = m.get(gid) ?? { count: 0, lastUsedAt: null };
        prev.count++;
        if (!prev.lastUsedAt || c.createdAt > prev.lastUsedAt) {
          prev.lastUsedAt = c.createdAt;
        }
        m.set(gid, prev);
      }
    }
    return m;
  }, [campaigns]);

  // ── 搜索+排序 ─────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items;
    if (q) {
      list = list.filter(
        (x) =>
          x.name.toLowerCase().includes(q) ||
          (x.description ?? '').toLowerCase().includes(q),
      );
    }
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'createdAsc':
          return a.createdAt.localeCompare(b.createdAt);
        case 'memberDesc':
          return b.memberCount - a.memberCount;
        case 'memberAsc':
          return a.memberCount - b.memberCount;
        case 'nameAsc':
          return a.name.localeCompare(b.name);
        case 'usageDesc':
          return (usageMap.get(b.id)?.count ?? 0) - (usageMap.get(a.id)?.count ?? 0);
        case 'createdDesc':
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return list;
  }, [items, search, sort, usageMap]);

  const totalMembers = useMemo(
    () => items.reduce((s, x) => s + (x.memberCount ?? 0), 0),
    [items],
  );

  const allSelected =
    filtered.length > 0 && filtered.every((x) => selected.includes(x.id));
  const partiallySelected = selected.length > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) setSelected([]);
    else setSelected(filtered.map((x) => x.id));
  };

  // ── 批量删除 ─────────────────────────────────
  const batchDelete = async () => {
    const ids = [...selected];
    setLoading(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await customerGroupsApi.remove(id);
        ok++;
      } catch {
        fail++;
      }
    }
    message[fail === 0 ? 'success' : 'warning'](`已删 ${ok} 个${fail > 0 ? ` · 失败 ${fail}` : ''}`);
    setSelected([]);
    await reload();
  };

  // ── 克隆 ─────────────────────────────────
  const cloneOne = async (id: number) => {
    try {
      const res = await customerGroupsApi.clone(id);
      message.success(`已克隆 · ${res.name}`);
      await reload();
    } catch (err) {
      message.error(extractErrorMessage(err, '克隆失败'));
    }
  };

  // ── 导出 CSV ─────────────────────────────────
  const exportCsv = async (g: CustomerGroup) => {
    try {
      const all: CustomerGroupMember[] = [];
      // 分页取全部
      let page = 1;
      const pageSize = 500;
      while (true) {
        const res = await customerGroupsApi.listMembers(g.id, page, pageSize);
        all.push(...res.items);
        if (res.items.length < pageSize) break;
        page++;
      }
      const header = 'phone,source,is_friend,created_at';
      const lines = all.map((m) =>
        [
          m.phoneE164,
          sourceLabel(m.source),
          m.isFriend === true ? 'yes' : m.isFriend === false ? 'no' : '',
          new Date(m.createdAt).toLocaleString('zh-CN', { hour12: false }),
        ].join(','),
      );
      const csv = '\ufeff' + [header, ...lines].join('\n'); // BOM for Excel UTF-8
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${g.name.replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(`已导出 ${all.length} 行`);
    } catch (err) {
      message.error(extractErrorMessage(err, '导出失败'));
    }
  };

  // ── 成员搜索 + 健康过滤 + 好友占比 ─────────────
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return members.filter((m) => {
      if (q && !m.phoneE164.toLowerCase().includes(q)) return false;
      if (memberFilter === 'ok' && m.sendStatus !== MemberSendStatus.Ok) return false;
      if (
        memberFilter === 'bad' &&
        m.sendStatus !== MemberSendStatus.BadInvalid &&
        m.sendStatus !== MemberSendStatus.BadNetwork
      )
        return false;
      if (memberFilter === 'opted' && m.sendStatus !== MemberSendStatus.OptedOut) return false;
      return true;
    });
  }, [members, memberSearch, memberFilter]);

  const friendStats = useMemo(() => {
    let friend = 0;
    let notFriend = 0;
    let unknown = 0;
    for (const m of members) {
      if (m.isFriend === true) friend++;
      else if (m.isFriend === false) notFriend++;
      else unknown++;
    }
    const total = members.length;
    return { friend, notFriend, unknown, total };
  }, [members]);

  // 2026-04-24 · 健康状态统计
  const healthStats = useMemo(() => {
    let ok = 0;
    let badInvalid = 0;
    let badNetwork = 0;
    let opted = 0;
    for (const m of members) {
      switch (m.sendStatus) {
        case MemberSendStatus.Ok:
          ok++;
          break;
        case MemberSendStatus.BadInvalid:
          badInvalid++;
          break;
        case MemberSendStatus.BadNetwork:
          badNetwork++;
          break;
        case MemberSendStatus.OptedOut:
          opted++;
          break;
      }
    }
    return { ok, badInvalid, badNetwork, opted, bad: badInvalid + badNetwork };
  }, [members]);

  return (
    <Drawer
      title={active ? `客户群 · ${active.name}` : '客户群管理'}
      open={open}
      onClose={onClose}
      width={780}
      extra={
        !active ? (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setImportForExistingId(null);
              setImportOpen(true);
            }}
            style={{ background: BRAND, borderColor: BRAND }}
          >
            新建客户群
          </Button>
        ) : (
          <Button icon={<LeftOutlined />} onClick={() => setActive(null)}>
            返回列表
          </Button>
        )
      }
    >
      {!active ? (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          {/* 顶部统计 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <StatCard label="客户群数量" value={items.length} icon={<TeamOutlined />} />
            <StatCard label="总号码数" value={totalMembers} icon={<UserAddOutlined />} />
          </div>

          {/* 搜索 + 排序 + 批量操作 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input
              prefix={<SearchOutlined style={{ color: '#bbb' }} />}
              placeholder="搜索客户群"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
              style={{ flex: 1, minWidth: 200 }}
            />
            <Dropdown
              menu={{
                items: (Object.keys(SORT_LABEL) as SortKey[]).map((k) => ({
                  key: k,
                  label: SORT_LABEL[k],
                })),
                selectable: true,
                selectedKeys: [sort],
                onClick: ({ key }) => setSort(key as SortKey),
              }}
            >
              <Button icon={<SortAscendingOutlined />}>{SORT_LABEL[sort]}</Button>
            </Dropdown>
          </div>

          {/* 批量操作栏 */}
          {filtered.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '6px 10px',
                background: selected.length > 0 ? BRAND_SOFT : '#fafafa',
                border: '1px solid #eee',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              <Checkbox
                checked={allSelected}
                indeterminate={partiallySelected}
                onChange={toggleAll}
              >
                全选本页
              </Checkbox>
              {selected.length > 0 ? (
                <>
                  <Typography.Text strong style={{ color: BRAND }}>
                    已选 {selected.length} 个
                  </Typography.Text>
                  <Popconfirm
                    title={`确定批量删除 ${selected.length} 个客户群?`}
                    description="会同时删除这些群的所有成员"
                    onConfirm={batchDelete}
                  >
                    <Button danger size="small" icon={<DeleteOutlined />}>
                      批量删除
                    </Button>
                  </Popconfirm>
                  <Button size="small" onClick={() => setSelected([])}>
                    取消选择
                  </Button>
                </>
              ) : (
                <Typography.Text type="secondary">勾选客户群以批量操作</Typography.Text>
              )}
            </div>
          )}

          {/* 列表 */}
          {loading ? (
            <Card loading style={{ minHeight: 120 }} />
          ) : filtered.length === 0 ? (
            <EmptyState
              search={search}
              onCreate={() => {
                setImportForExistingId(null);
                setImportOpen(true);
              }}
            />
          ) : (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {filtered.map((row) => (
                <GroupCard
                  key={row.id}
                  group={row}
                  usage={usageMap.get(row.id)}
                  selected={selected.includes(row.id)}
                  onToggle={(checked) => {
                    setSelected((prev) =>
                      checked ? [...prev, row.id] : prev.filter((x) => x !== row.id),
                    );
                  }}
                  onView={() => setActive(row)}
                  onImport={() => {
                    setImportForExistingId(row.id);
                    setImportOpen(true);
                  }}
                  onClone={() => cloneOne(row.id)}
                  onExport={() => exportCsv(row)}
                  onDelete={async () => {
                    try {
                      await customerGroupsApi.remove(row.id);
                      message.success('已删除');
                      await reload();
                    } catch (err) {
                      message.error(extractErrorMessage(err, '删除失败'));
                    }
                  }}
                />
              ))}
            </Space>
          )}
        </Space>
      ) : (
        // 详情页
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions size="small" column={2} bordered style={{ background: '#fff', borderRadius: 8 }}>
            <Descriptions.Item label="名称">{active.name}</Descriptions.Item>
            <Descriptions.Item label="成员数">
              <Tag color="blue" style={{ fontSize: 13 }}>
                {active.memberCount} 人
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="创建时间" span={2}>
              {formatTime(active.createdAt)}
            </Descriptions.Item>
            {(() => {
              const u = usageMap.get(active.id);
              return u ? (
                <Descriptions.Item label="引用情况" span={2}>
                  <Space size="large">
                    <span>
                      被 <b style={{ color: BRAND }}>{u.count}</b> 个投放引用
                    </span>
                    {u.lastUsedAt && (
                      <Typography.Text type="secondary">
                        最近使用 · {relativeTime(u.lastUsedAt)}
                      </Typography.Text>
                    )}
                  </Space>
                </Descriptions.Item>
              ) : (
                <Descriptions.Item label="引用情况" span={2}>
                  <Typography.Text type="secondary">未被任何投放引用</Typography.Text>
                </Descriptions.Item>
              );
            })()}
            {active.description && (
              <Descriptions.Item label="描述" span={2}>
                {active.description}
              </Descriptions.Item>
            )}
          </Descriptions>

          {/* 好友占比条 */}
          {friendStats.total > 0 && <FriendBar stats={friendStats} />}

          <Card size="small">
            <Space wrap>
              <Button
                type="primary"
                icon={<ImportOutlined />}
                onClick={() => {
                  setImportForExistingId(active.id);
                  setImportOpen(true);
                }}
                style={{ background: BRAND, borderColor: BRAND }}
              >
                追加号码
              </Button>
              <Button icon={<UserAddOutlined />} onClick={() => setPickerOpen(true)}>
                从联系人挑选
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => exportCsv(active)}>
                导出 CSV
              </Button>
              <Button icon={<CopyOutlined />} onClick={() => cloneOne(active.id)}>
                克隆群
              </Button>
              <Popconfirm
                title="清空所有成员?"
                description="群保留, 只删成员"
                onConfirm={async () => {
                  try {
                    const res = await customerGroupsApi.clearMembers(active.id);
                    message.success(`已清空 ${res.removed} 个成员`);
                    await reload();
                    await reloadMembers(active.id);
                  } catch (err) {
                    message.error(extractErrorMessage(err, '清空失败'));
                  }
                }}
              >
                <Button danger icon={<DeleteOutlined />}>
                  清空成员
                </Button>
              </Popconfirm>
            </Space>
          </Card>

          {/* 健康状态统计 + 过滤 */}
          {members.length > 0 && <HealthBar stats={healthStats} />}

          {/* 成员搜索 + 健康过滤 */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input
              prefix={<SearchOutlined style={{ color: '#bbb' }} />}
              placeholder="搜索成员手机号"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              allowClear
              style={{ flex: 1, minWidth: 200 }}
            />
            <Radio.Group
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              buttonStyle="solid"
            >
              <Radio.Button value="all">全部 {members.length}</Radio.Button>
              <Radio.Button value="ok">
                <span style={{ color: memberFilter === 'ok' ? '#fff' : BRAND }}>✓ 正常 {healthStats.ok}</span>
              </Radio.Button>
              <Radio.Button value="bad">
                <span style={{ color: memberFilter === 'bad' ? '#fff' : '#f5222d' }}>✗ 坏号 {healthStats.bad}</span>
              </Radio.Button>
              <Radio.Button value="opted">禁用 {healthStats.opted}</Radio.Button>
            </Radio.Group>
          </div>

          <Table
            size="small"
            loading={membersLoading}
            rowKey="id"
            dataSource={filteredMembers}
            columns={[
              {
                title: '手机号',
                dataIndex: 'phoneE164',
                render: (v: string, row: CustomerGroupMember) => (
                  <Space>
                    <span style={{ color: row.sendStatus !== 0 ? '#999' : undefined }}>{v}</span>
                  </Space>
                ),
              },
              {
                title: '状态',
                dataIndex: 'sendStatus',
                width: 110,
                render: (s: number, row: CustomerGroupMember) => (
                  <StatusCell status={s} member={row} />
                ),
              },
              {
                title: '已发/失败',
                width: 90,
                render: (_: unknown, row: CustomerGroupMember) =>
                  row.sendCount > 0 || row.failCount > 0 ? (
                    <Typography.Text style={{ fontSize: 12 }}>
                      <span style={{ color: BRAND }}>{row.sendCount}</span>
                      {' / '}
                      <span style={{ color: row.failCount > 0 ? '#f5222d' : '#999' }}>{row.failCount}</span>
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      —
                    </Typography.Text>
                  ),
              },
              {
                title: '来源',
                dataIndex: 'source',
                width: 70,
                render: (v: number) => <Tag>{sourceLabel(v)}</Tag>,
              },
              {
                title: '操作',
                key: 'op',
                width: 170,
                render: (_: unknown, row: CustomerGroupMember) => (
                  <Space size={4}>
                    {row.sendStatus !== MemberSendStatus.Ok ? (
                      <Tooltip title="解禁 · 把号码恢复成正常 · 下次投放会发给他">
                        <Button
                          size="small"
                          type="link"
                          style={{ padding: 0, color: BRAND }}
                          onClick={async () => {
                            try {
                              await customerGroupsApi.setMemberStatus(active.id, row.id, MemberSendStatus.Ok);
                              message.success('已解禁');
                              await reloadMembers(active.id);
                            } catch (err) {
                              message.error(extractErrorMessage(err, '操作失败'));
                            }
                          }}
                        >
                          解禁
                        </Button>
                      </Tooltip>
                    ) : (
                      <Tooltip title="不再发给这个号 · 但保留在群里">
                        <Button
                          size="small"
                          type="link"
                          style={{ padding: 0, color: '#fa8c16' }}
                          onClick={async () => {
                            try {
                              await customerGroupsApi.setMemberStatus(active.id, row.id, MemberSendStatus.OptedOut);
                              message.success('已标记 · 不再发送');
                              await reloadMembers(active.id);
                            } catch (err) {
                              message.error(extractErrorMessage(err, '操作失败'));
                            }
                          }}
                        >
                          禁用
                        </Button>
                      </Tooltip>
                    )}
                    <Popconfirm
                      title="移除这个成员?"
                      onConfirm={async () => {
                        try {
                          await customerGroupsApi.removeMember(active.id, row.id);
                          message.success('已移除');
                          await reload();
                          await reloadMembers(active.id);
                        } catch (err) {
                          message.error(extractErrorMessage(err, '移除失败'));
                        }
                      }}
                    >
                      <a style={{ color: '#f5222d' }}>移除</a>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
            pagination={{ pageSize: 20 }}
            locale={{
              emptyText:
                memberSearch || memberFilter !== 'all' ? (
                  <div style={{ padding: 24, color: '#999' }}>没有匹配的号码</div>
                ) : (
                  <Empty description="群内还没有号码" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ),
            }}
          />
        </Space>
      )}

      <CustomerGroupImportModal
        open={importOpen}
        groupId={importForExistingId}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          await reload();
          if (active) await reloadMembers(active.id);
        }}
      />

      {active && (
        <ContactPickerModal
          open={pickerOpen}
          groupId={active.id}
          groupName={active.name}
          slots={slots}
          onClose={() => setPickerOpen(false)}
          onImported={async () => {
            await reload();
            await reloadMembers(active.id);
          }}
        />
      )}
    </Drawer>
  );
}

// ───────────────────────────────────────────────
// 群卡片
// ───────────────────────────────────────────────
function GroupCard({
  group,
  usage,
  selected,
  onToggle,
  onView,
  onImport,
  onClone,
  onExport,
  onDelete,
}: {
  group: CustomerGroup;
  usage: Usage | undefined;
  selected: boolean;
  onToggle: (checked: boolean) => void;
  onView: () => void;
  onImport: () => void;
  onClone: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const colorPool = ['#25d366', '#1677ff', '#722ed1', '#fa8c16', '#eb2f96', '#13c2c2'];
  const avatarColor = colorPool[group.id % colorPool.length];
  const initial = group.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '14px 16px',
        border: `1px solid ${selected ? BRAND : '#eaeaea'}`,
        borderRadius: 10,
        background: selected ? BRAND_SOFT : '#fff',
        boxShadow: selected
          ? '0 2px 10px rgba(37,211,102,0.12)'
          : '0 1px 3px rgba(0,0,0,0.03)',
        transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
      }}
    >
      {/* 选择框 */}
      <Checkbox
        checked={selected}
        onChange={(e) => onToggle(e.target.checked)}
        style={{ marginRight: 12 }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* 头像 */}
      <div
        onClick={onView}
        style={{
          width: 42,
          height: 42,
          borderRadius: 10,
          background: avatarColor,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          fontWeight: 600,
          flexShrink: 0,
          marginRight: 14,
          cursor: 'pointer',
        }}
      >
        {initial}
      </div>

      {/* 主体信息 */}
      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onView}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {group.name}
          </Typography.Text>
          <Tag color="blue" style={{ margin: 0 }}>
            {group.memberCount} 人
          </Tag>
          {group.memberCount === 0 && (
            <Tag color="default" style={{ margin: 0 }}>
              空组
            </Tag>
          )}
          {(group.badCount ?? 0) > 0 && (
            <Tooltip title={`${group.badCount} 个坏号已被系统标记 · 下次投放自动跳过`}>
              <Tag color="red" style={{ margin: 0 }}>
                ⚠ {group.badCount} 坏号
              </Tag>
            </Tooltip>
          )}
          {usage && usage.count > 0 ? (
            <Tooltip
              title={
                usage.lastUsedAt
                  ? `最近使用 · ${formatTime(usage.lastUsedAt)}`
                  : ''
              }
            >
              <Tag color="purple" style={{ margin: 0 }}>
                {usage.count} 次引用
              </Tag>
            </Tooltip>
          ) : (
            <Tag color="default" style={{ margin: 0, color: '#aaa' }}>
              未使用
            </Tag>
          )}
        </div>
        <div
          style={{
            fontSize: 12,
            color: '#8c8c8c',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {group.description || '无描述'}
          </span>
          <Tooltip title={formatTime(group.createdAt)}>
            <span style={{ color: '#bbb' }}>创建 {relativeTime(group.createdAt)}</span>
          </Tooltip>
          {usage?.lastUsedAt && (
            <Tooltip title={formatTime(usage.lastUsedAt)}>
              <span style={{ color: '#bbb' }}>· 最近投放 {relativeTime(usage.lastUsedAt)}</span>
            </Tooltip>
          )}
        </div>
      </div>

      {/* 操作 */}
      <Space size={4} onClick={(e) => e.stopPropagation()}>
        <Tooltip title="追加号码">
          <Button type="text" icon={<ImportOutlined />} onClick={onImport} style={{ color: BRAND }} />
        </Tooltip>
        <Button type="link" onClick={onView} style={{ padding: '0 6px' }}>
          查看成员
        </Button>
        <Dropdown
          menu={{
            items: [
              { key: 'clone', icon: <CopyOutlined />, label: '克隆群', onClick: onClone },
              { key: 'export', icon: <DownloadOutlined />, label: '导出 CSV', onClick: onExport },
              { type: 'divider' },
              {
                key: 'del',
                danger: true,
                label: (
                  <Popconfirm title="删除这个客户群?" description="会同时删除所有成员" onConfirm={onDelete}>
                    <span>
                      <DeleteOutlined /> 删除
                    </span>
                  </Popconfirm>
                ),
              },
            ],
          }}
          trigger={['click']}
        >
          <Button type="text" icon={<EllipsisOutlined />} />
        </Dropdown>
      </Space>
    </div>
  );
}

// ───────────────────────────────────────────────
// 健康状态统计条
// ───────────────────────────────────────────────
function HealthBar({
  stats,
}: {
  stats: { ok: number; badInvalid: number; badNetwork: number; opted: number; bad: number };
}) {
  const total = stats.ok + stats.bad + stats.opted;
  if (total === 0) return null;
  const pctOk = Math.round((stats.ok / total) * 100);
  const hasIssue = stats.bad > 0 || stats.opted > 0;
  return (
    <div
      style={{
        padding: 12,
        border: `1px solid ${hasIssue ? '#ffccc7' : '#b7eb8f'}`,
        background: hasIssue ? '#fff2f0' : '#f6ffed',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>号码健康度</span>
        <span style={{ fontSize: 12, color: '#666' }}>
          可用 <b style={{ color: BRAND }}>{pctOk}%</b>
        </span>
      </div>
      <Progress
        percent={100}
        showInfo={false}
        strokeColor={{ '0%': BRAND, '100%': BRAND }}
        success={{ percent: pctOk, strokeColor: BRAND }}
      />
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12, flexWrap: 'wrap' }}>
        <HealthLegend color={BRAND} label="正常" count={stats.ok} />
        <HealthLegend color="#f5222d" label="号码无效" count={stats.badInvalid} hint="发送时 WA 返无效号 · 自动拉黑" />
        <HealthLegend color="#fa541c" label="连续失败" count={stats.badNetwork} hint="连续 3 次网络失败 · 可解禁" />
        <HealthLegend color="#fa8c16" label="人工禁用" count={stats.opted} hint="手动标记 · 不再发送" />
      </div>
    </div>
  );
}

function HealthLegend({
  color,
  label,
  count,
  hint,
}: {
  color: string;
  label: string;
  count: number;
  hint?: string;
}) {
  const content = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 8, height: 8, background: color, borderRadius: 2, display: 'inline-block' }} />
      <span style={{ color: count > 0 ? '#333' : '#bbb' }}>
        {label} {count}
      </span>
    </span>
  );
  return hint ? <Tooltip title={hint}>{content}</Tooltip> : content;
}

// 状态单元格 · 给详情表的"状态"列用
function StatusCell({ status, member }: { status: number; member: CustomerGroupMember }) {
  const tip = member.lastErrorMsg ?? member.lastErrorCode ?? undefined;
  switch (status) {
    case MemberSendStatus.Ok:
      return <Tag color="success">正常</Tag>;
    case MemberSendStatus.BadInvalid:
      return (
        <Tooltip title={tip ?? '号码无效 · 自动拉黑'}>
          <Tag color="error">号码无效</Tag>
        </Tooltip>
      );
    case MemberSendStatus.BadNetwork:
      return (
        <Tooltip title={tip ?? '连续多次失败 · 可解禁重试'}>
          <Tag color="volcano">连续失败</Tag>
        </Tooltip>
      );
    case MemberSendStatus.OptedOut:
      return <Tag color="warning">人工禁用</Tag>;
    default:
      return <Tag>未知 {status}</Tag>;
  }
}

// ───────────────────────────────────────────────
// 好友占比条
// ───────────────────────────────────────────────
function FriendBar({
  stats,
}: {
  stats: { friend: number; notFriend: number; unknown: number; total: number };
}) {
  const { friend, notFriend, unknown, total } = stats;
  const pF = total ? Math.round((friend / total) * 100) : 0;
  const pN = total ? Math.round((notFriend / total) * 100) : 0;
  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 13 }}>好友 / 陌生人分布</span>}
      styles={{ body: { padding: 12 } }}
    >
      <Progress
        percent={100}
        showInfo={false}
        strokeColor={{ '0%': BRAND, '50%': BRAND, '51%': '#ff7875', '100%': '#ff7875' }}
        success={{ percent: pF, strokeColor: BRAND }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 8,
          fontSize: 12,
          color: '#666',
        }}
      >
        <span>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: BRAND, borderRadius: 2, marginRight: 6 }} />
          好友 {friend} ({pF}%)
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#ff7875', borderRadius: 2, marginRight: 6 }} />
          陌生 {notFriend} ({pN}%)
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#d9d9d9', borderRadius: 2, marginRight: 6 }} />
          未知 {unknown}
        </span>
      </div>
    </Card>
  );
}

// ───────────────────────────────────────────────
// 空态
// ───────────────────────────────────────────────
function EmptyState({ search, onCreate }: { search: string; onCreate: () => void }) {
  return (
    <div
      style={{
        padding: '48px 20px',
        textAlign: 'center',
        border: '1px dashed #e0e0e0',
        borderRadius: 10,
        background: '#fafafa',
      }}
    >
      <div
        style={{
          width: 60,
          height: 60,
          borderRadius: 30,
          background: BRAND_SOFT,
          color: BRAND,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
          marginBottom: 12,
        }}
      >
        <TeamOutlined />
      </div>
      <div style={{ fontSize: 15, color: '#555', marginBottom: 4 }}>
        {search ? '没有匹配的客户群' : '还没有客户群'}
      </div>
      <div style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>
        {search ? '换个关键字试试' : '从 Excel / 粘贴号码开始创建第一个客户群'}
      </div>
      {!search && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={onCreate}
          style={{ background: BRAND, borderColor: BRAND }}
        >
          新建客户群
        </Button>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────
// 统计卡
// ───────────────────────────────────────────────
function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        border: '1px solid #eaeaea',
        borderRadius: 10,
        background: BRAND_SOFT,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: '#fff',
          color: BRAND,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: '#333', lineHeight: 1.1 }}>
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────
// 时间工具
// ───────────────────────────────────────────────
function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function relativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return '刚刚';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} 天前`;
    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo} 个月前`;
    return `${Math.floor(mo / 12)} 年前`;
  } catch {
    return '';
  }
}
