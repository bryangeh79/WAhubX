// 2026-04-24 · 从 wa_contact 挑选联系人入群
import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Alert,
} from 'antd';
import type { TableRowSelection } from 'antd/es/table/interface';
import { SearchOutlined, UserAddOutlined } from '@ant-design/icons';
import { customerGroupsApi, type ContactOption, type ActiveSlot } from '@/lib/campaigns-api';
import { extractErrorMessage } from '@/lib/api';
import { BRAND } from '../wizard/shared';

interface Props {
  open: boolean;
  groupId: number;
  groupName: string;
  slots: ActiveSlot[]; // 账号列表供过滤
  onClose: () => void;
  onImported: () => void;
}

export function ContactPickerModal({ open, groupId, groupName, slots, onClose, onImported }: Props) {
  const { message } = App.useApp();
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [accountId, setAccountId] = useState<number | undefined>(undefined);
  const [selected, setSelected] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await customerGroupsApi.listContacts({
        accountId,
        keyword: keyword.trim() || undefined,
        limit: 300,
      });
      setContacts(res);
    } catch (err) {
      message.error(extractErrorMessage(err, '加载联系人失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSelected([]);
      setKeyword('');
      setAccountId(undefined);
      void reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 搜索触发 (本地节流: 输入 1s 后 reload, 简单用 button + 回车就行)
  const accountOptions = useMemo(
    () => [
      { value: undefined, label: '所有账号' },
      ...slots.map((s) => ({
        value: s.accountId,
        label: `${s.slotIndex}. ${s.phoneNumber ?? '(未绑)'}`,
      })),
    ],
    [slots],
  );

  const rowSelection: TableRowSelection<ContactOption> = {
    selectedRowKeys: selected,
    onChange: (keys) => setSelected(keys as number[]),
    preserveSelectedRowKeys: true,
  };

  const handleImport = async () => {
    if (selected.length === 0) {
      message.warning('先勾选至少 1 个联系人');
      return;
    }
    setSubmitting(true);
    try {
      const res = await customerGroupsApi.pickContacts(groupId, selected);
      message.success(`导入完成 · 新增 ${res.added} · 跳过重复 ${res.skippedDuplicate} · 无效 ${res.skippedInvalid}`);
      onImported();
      onClose();
    } catch (err) {
      message.error(extractErrorMessage(err, '导入失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <UserAddOutlined style={{ color: BRAND }} />
          <span>从联系人挑选 → {groupName}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={760}
      footer={null}
      destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="只列出本租户 WA 账号下已出现过的联系人 · 最多 300 条"
        />

        <Space style={{ width: '100%' }}>
          <Select
            style={{ width: 260 }}
            value={accountId}
            onChange={(v) => setAccountId(v)}
            options={accountOptions}
            placeholder="按账号过滤"
          />
          <Input
            style={{ width: 260 }}
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="搜索名称或号码"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={reload}
            allowClear
          />
          <Button onClick={reload} loading={loading}>
            搜索
          </Button>
        </Space>

        <Table<ContactOption>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={contacts}
          rowSelection={rowSelection}
          pagination={{ pageSize: 15 }}
          columns={[
            {
              title: '名称',
              dataIndex: 'displayName',
              render: (v: string | null) => v || <Typography.Text type="secondary">(未备注)</Typography.Text>,
            },
            { title: '手机号', dataIndex: 'phoneE164' },
            {
              title: '所属账号',
              dataIndex: 'accountId',
              width: 100,
              render: (aid: number) => {
                const s = slots.find((x) => x.accountId === aid);
                return s ? <Tag>槽 {s.slotIndex}</Tag> : <Tag>#{aid}</Tag>;
              },
            },
            {
              title: '最近互动',
              dataIndex: 'lastMessageAt',
              width: 140,
              render: (v: string | null) =>
                v ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(v).toLocaleString('zh-CN', { hour12: false })}
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary">—</Typography.Text>
                ),
            },
          ]}
        />

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            paddingTop: 8,
            borderTop: '1px solid #f0f0f0',
          }}
        >
          <Typography.Text type="secondary">已选 {selected.length} 个</Typography.Text>
          <Space>
            <Button onClick={onClose} disabled={submitting}>
              取消
            </Button>
            <Button
              type="primary"
              loading={submitting}
              disabled={selected.length === 0}
              onClick={handleImport}
              style={{ background: BRAND, borderColor: BRAND }}
            >
              导入 {selected.length} 个联系人
            </Button>
          </Space>
        </div>
      </Space>
    </Modal>
  );
}
