// 2026-04-22 · 批量 SIM 信息录入 · 统一套运营商 · 一次保存多槽
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Checkbox,
  Input,
  message,
  Modal,
  Radio,
  Select,
  Space,
  Typography,
} from 'antd';
import { api, extractErrorMessage } from '@/lib/api';
import { inferFromPhone, type Country } from './types';

const { Text } = Typography;

interface SlotLite {
  id: number;
  slotIndex: number;
  phoneNumber: string | null;
  status: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  slots: SlotLite[];
}

export function SimInfoBulkModal({ open, onClose, onSaved, slots }: Props) {
  const [registry, setRegistry] = useState<Country[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<Set<number>>(new Set());
  const [countryCode, setCountryCode] = useState<string | null>('MY');
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [useCustomCarrier, setUseCustomCarrier] = useState(false);
  const [customCarrierName, setCustomCarrierName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .get<Country[]>('/slots/sim-info/telco-registry')
      .then((r) => setRegistry(r.data))
      .catch(() => message.error('加载运营商库失败'));
  }, [open]);

  useEffect(() => {
    if (open) {
      // 默认不勾 · 让租户主动选
      setSelectedSlots(new Set());
      setCarrierId(null);
      setUseCustomCarrier(false);
      setCustomCarrierName('');
      setNotes('');
    }
  }, [open]);

  // 按国家分组 · 方便勾选
  const slotsByCountry = useMemo(() => {
    const groups = new Map<string, SlotLite[]>();
    for (const s of slots) {
      const inferred = inferFromPhone(s.phoneNumber, registry);
      const key = inferred.country
        ? `${inferred.country.flag} ${inferred.country.name}`
        : '❓ 未识别';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }
    return Array.from(groups.entries());
  }, [slots, registry]);

  const selectedCountry = useMemo(
    () => (countryCode ? registry.find((c) => c.code === countryCode) : null),
    [registry, countryCode],
  );

  const toggleSlot = (id: number) => {
    const next = new Set(selectedSlots);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSlots(next);
  };

  const toggleGroup = (groupSlots: SlotLite[]) => {
    const next = new Set(selectedSlots);
    const allSelected = groupSlots.every((s) => next.has(s.id));
    if (allSelected) {
      for (const s of groupSlots) next.delete(s.id);
    } else {
      for (const s of groupSlots) next.add(s.id);
    }
    setSelectedSlots(next);
  };

  const handleSave = async () => {
    if (selectedSlots.size === 0) {
      message.warning('请先勾选要设置的槽位');
      return;
    }
    if (!useCustomCarrier && !carrierId) {
      message.warning('请选运营商 (或切"其他"手填)');
      return;
    }
    if (useCustomCarrier && !customCarrierName.trim()) {
      message.warning('请填运营商名');
      return;
    }

    setSaving(true);
    try {
      const items = Array.from(selectedSlots).map((slotId) => ({
        slotId,
        countryCode,
        carrierId: useCustomCarrier ? null : carrierId,
        customCarrierName: useCustomCarrier ? customCarrierName.trim() : null,
        notes: notes.trim() || null,
      }));
      const r = await api.post<{ updated: number; errors: Array<{ slotId: number; message: string }> }>(
        '/slots/sim-info/bulk',
        { items },
      );
      if (r.data.errors.length > 0) {
        message.warning(
          `更新 ${r.data.updated} 成功 · ${r.data.errors.length} 失败 · 第一个: ${r.data.errors[0].message}`,
        );
      } else {
        message.success(`已批量更新 ${r.data.updated} 个槽位`);
      }
      onSaved();
    } catch (err) {
      message.error(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="📝 批量设置 SIM 信息"
      onOk={handleSave}
      confirmLoading={saving}
      okText={`保存 (${selectedSlots.size} 个)`}
      cancelText="取消"
      width={640}
      destroyOnClose
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="选择要一起设置的槽位"
          description="从相同运营商买的一批 SIM · 一次设完. 可按国家分组全选."
        />

        {/* 槽位勾选 · 按国家分组 */}
        <div
          style={{
            maxHeight: 260,
            overflowY: 'auto',
            border: '1px solid #f0f0f0',
            borderRadius: 4,
            padding: 8,
          }}
        >
          {slotsByCountry.length === 0 && (
            <Text type="secondary">没有活跃槽位可设置</Text>
          )}
          {slotsByCountry.map(([groupName, groupSlots]) => {
            const allSelected = groupSlots.every((s) => selectedSlots.has(s.id));
            const someSelected = groupSlots.some((s) => selectedSlots.has(s.id));
            return (
              <div key={groupName} style={{ marginBottom: 8 }}>
                <Checkbox
                  checked={allSelected}
                  indeterminate={!allSelected && someSelected}
                  onChange={() => toggleGroup(groupSlots)}
                >
                  <Text strong>
                    {groupName} ({groupSlots.length})
                  </Text>
                </Checkbox>
                <div style={{ marginLeft: 24, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {groupSlots.map((s) => (
                    <Checkbox
                      key={s.id}
                      checked={selectedSlots.has(s.id)}
                      onChange={() => toggleSlot(s.id)}
                      style={{ minWidth: 200 }}
                    >
                      #{s.slotIndex} · {s.phoneNumber ?? '未命名'}
                    </Checkbox>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* 统一应用的设置 */}
        <div>
          <div style={{ marginBottom: 6 }}>
            <Text strong>🌍 国家 (应用到所有勾选的槽位)</Text>
          </div>
          <Select
            showSearch
            placeholder="选国家"
            value={countryCode ?? undefined}
            onChange={(v) => {
              setCountryCode(v);
              setCarrierId(null);
            }}
            style={{ width: '100%' }}
            optionFilterProp="label"
            options={registry.map((c) => ({
              value: c.code,
              label: `${c.flag} ${c.name} (+${c.callingCode})`,
            }))}
          />
        </div>

        <div>
          <div style={{ marginBottom: 6 }}>
            <Text strong>📶 运营商 (统一设置)</Text>
          </div>
          <Radio.Group
            value={useCustomCarrier ? 'custom' : 'preset'}
            onChange={(e) => setUseCustomCarrier(e.target.value === 'custom')}
            style={{ marginBottom: 8 }}
          >
            <Radio value="preset">预置</Radio>
            <Radio value="custom">其他 (手填)</Radio>
          </Radio.Group>
          {!useCustomCarrier ? (
            <Select
              placeholder="选运营商"
              value={carrierId ?? undefined}
              onChange={(v) => setCarrierId(v)}
              style={{ width: '100%' }}
              disabled={!selectedCountry}
              options={(selectedCountry?.telcos ?? []).map((t) => ({
                value: t.id,
                label: t.brand ? `${t.name} (${t.brand})` : t.name,
              }))}
            />
          ) : (
            <Input
              placeholder="运营商名"
              value={customCarrierName}
              onChange={(e) => setCustomCarrierName(e.target.value)}
              maxLength={80}
            />
          )}
        </div>

        <div>
          <div style={{ marginBottom: 6 }}>
            <Text strong>📝 备注 (可选 · 批量应用)</Text>
          </div>
          <Input
            placeholder="例: '一批 10 张 Maxis 预付卡 · 2026-04 买'"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={200}
          />
        </div>

        <Alert
          type="warning"
          showIcon
          message="批量模式不设 ICCID 尾号"
          description="ICCID 每张卡不同 · 批量无法统一. 如需填 ICCID · 请在槽位卡上单独编辑."
        />
      </Space>
    </Modal>
  );
}
