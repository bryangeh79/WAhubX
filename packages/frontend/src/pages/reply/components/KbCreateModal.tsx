// 2026-04-24 · 新建 KB Modal
import { useState } from 'react';
import { App, Checkbox, Input, Modal, Typography } from 'antd';
import { kbApi, type KnowledgeBase } from '@/lib/intelligent-reply-api';
import { extractErrorMessage } from '@/lib/api';

const BRAND = '#25d366';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (kb: KnowledgeBase) => void;
}

export function KbCreateModal({ open, onClose, onCreated }: Props) {
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [goal, setGoal] = useState('让客户了解产品 · 留下联系方式 · 预约咨询');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
    setGoal('让客户了解产品 · 留下联系方式 · 预约咨询');
    setIsDefault(false);
  };

  const handleOk = async () => {
    if (!name.trim()) {
      message.warning('请填知识库名称');
      return;
    }
    setSaving(true);
    try {
      const kb = await kbApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        goalPrompt: goal.trim() || undefined,
        isDefault,
      });
      message.success('已创建');
      reset();
      onCreated(kb);
    } catch (err) {
      message.error(extractErrorMessage(err, '创建失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="新建知识库"
      open={open}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={handleOk}
      confirmLoading={saving}
      okText="创建"
      okButtonProps={{ style: { background: BRAND, borderColor: BRAND } }}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <Typography.Text strong>名称</Typography.Text>
          <Input
            placeholder="例: 主产品 / VIP 套餐 / 2026 618 大促"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={128}
            showCount
            style={{ marginTop: 4 }}
          />
        </div>
        <div>
          <Typography.Text strong>描述</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
            (可选 · 自己记笔记)
          </Typography.Text>
          <Input.TextArea
            placeholder="简短描述这个知识库的用途"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={512}
            style={{ marginTop: 4 }}
          />
        </div>
        <div>
          <Typography.Text strong>业务目标</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
            (AI 回复时的"终极目标")
          </Typography.Text>
          <Input.TextArea
            placeholder="一句话说明 AI 应该引导客户去哪"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            maxLength={512}
            style={{ marginTop: 4 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            例: "让客户留下电话 · 引导预约 demo" / "促进订单 · 引到客服小莹"
          </Typography.Text>
        </div>
        <Checkbox checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)}>
          设为默认知识库 (没绑定 campaign 的对话都用这个)
        </Checkbox>
      </div>
    </Modal>
  );
}
