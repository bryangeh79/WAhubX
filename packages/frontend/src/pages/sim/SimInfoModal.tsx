// 2026-04-22 · 单槽位 SIM 信息录入 · 3-Tier 兜底
import { useEffect, useMemo, useState } from 'react';
import { Alert, Input, message, Modal, Radio, Select, Space, Typography } from 'antd';
import { api, extractErrorMessage } from '@/lib/api';
import { inferFromPhone, type Country, type SimInfoPayload } from './types';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  slotId: number;
  slotIndex: number;
  phoneNumber: string | null;
  // 当前已有 sim info · 编辑模式用 · 无则新建
  initial?: {
    countryCode?: string | null;
    carrierId?: string | null;
    customCarrierName?: string | null;
    customCountryName?: string | null;
    iccidSuffix?: string | null;
    notes?: string | null;
  } | null;
}

export function SimInfoModal({
  open,
  onClose,
  onSaved,
  slotId,
  slotIndex,
  phoneNumber,
  initial,
}: Props) {
  const [registry, setRegistry] = useState<Country[]>([]);
  const [loadingRegistry, setLoadingRegistry] = useState(false);

  // 表单状态
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [useCustomCountry, setUseCustomCountry] = useState(false);
  const [customCountryName, setCustomCountryName] = useState('');
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [useCustomCarrier, setUseCustomCarrier] = useState(false);
  const [customCarrierName, setCustomCarrierName] = useState('');
  const [iccidSuffix, setIccidSuffix] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // 加载 registry
  useEffect(() => {
    if (!open) return;
    setLoadingRegistry(true);
    api
      .get<Country[]>('/slots/sim-info/telco-registry')
      .then((r) => setRegistry(r.data))
      .catch(() => message.error('加载运营商库失败'))
      .finally(() => setLoadingRegistry(false));
  }, [open]);

  // open 时根据 phoneNumber 自动推断 + 套用 initial
  useEffect(() => {
    if (!open || registry.length === 0) return;
    const inferred = inferFromPhone(phoneNumber, registry);

    if (initial) {
      // 编辑模式 · 套用已有
      setCountryCode(initial.countryCode ?? null);
      setUseCustomCountry(!initial.countryCode && !!initial.customCountryName);
      setCustomCountryName(initial.customCountryName ?? '');
      setCarrierId(initial.carrierId ?? null);
      setUseCustomCarrier(!initial.carrierId && !!initial.customCarrierName);
      setCustomCarrierName(initial.customCarrierName ?? '');
      setIccidSuffix(initial.iccidSuffix ?? '');
      setNotes(initial.notes ?? '');
    } else {
      // 新建 · 自动推断
      setCountryCode(inferred.country?.code ?? null);
      setUseCustomCountry(!inferred.country);
      setCustomCountryName('');
      setCarrierId(inferred.defaultTelcoId);
      setUseCustomCarrier(false);
      setCustomCarrierName('');
      setIccidSuffix('');
      setNotes('');
    }
  }, [open, registry, phoneNumber, initial]);

  const selectedCountry = useMemo(
    () => (countryCode ? registry.find((c) => c.code === countryCode) : null),
    [registry, countryCode],
  );

  const handleSave = async () => {
    const payload: SimInfoPayload = {
      countryCode: useCustomCountry ? null : countryCode,
      carrierId: useCustomCarrier ? null : carrierId,
      customCarrierName: useCustomCarrier ? customCarrierName.trim() || null : null,
      customCountryName: useCustomCountry ? customCountryName.trim() || null : null,
      iccidSuffix: iccidSuffix.trim() || null,
      notes: notes.trim() || null,
    };

    // 校验
    if (useCustomCountry && !payload.customCountryName) {
      message.warning('请填国家名');
      return;
    }
    if (!useCustomCountry && !payload.countryCode) {
      message.warning('请选国家');
      return;
    }
    if (useCustomCarrier && !payload.customCarrierName) {
      message.warning('请填运营商名');
      return;
    }

    setSaving(true);
    try {
      await api.patch(`/slots/${slotId}/sim-info`, payload);
      message.success('SIM 信息已保存');
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
      title={`📶 SIM 信息 · #${slotIndex}${phoneNumber ? ` · ${phoneNumber}` : ''}`}
      onOk={handleSave}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      width={560}
      destroyOnClose
    >
      {loadingRegistry ? (
        <Text>加载中...</Text>
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 国家 */}
          <div>
            <div style={{ marginBottom: 6 }}>
              <Text strong>🌍 国家</Text>
            </div>
            <Radio.Group
              value={useCustomCountry ? 'custom' : 'preset'}
              onChange={(e) => setUseCustomCountry(e.target.value === 'custom')}
              style={{ marginBottom: 8 }}
            >
              <Radio value="preset">预置国家</Radio>
              <Radio value="custom">其他 (手填)</Radio>
            </Radio.Group>
            {!useCustomCountry ? (
              <Select
                showSearch
                placeholder="选国家"
                value={countryCode ?? undefined}
                onChange={(v) => {
                  setCountryCode(v);
                  setCarrierId(null); // 换国家清 telco
                }}
                style={{ width: '100%' }}
                optionFilterProp="label"
                options={registry.map((c) => ({
                  value: c.code,
                  label: `${c.flag} ${c.name} (+${c.callingCode})`,
                }))}
              />
            ) : (
              <Input
                placeholder="例: Nepal · Somalia · ..."
                value={customCountryName}
                onChange={(e) => setCustomCountryName(e.target.value)}
                maxLength={80}
              />
            )}
          </div>

          {/* 运营商 */}
          <div>
            <div style={{ marginBottom: 6 }}>
              <Text strong>📶 运营商</Text>
            </div>
            {selectedCountry && !useCustomCountry ? (
              <>
                <Radio.Group
                  value={useCustomCarrier ? 'custom' : 'preset'}
                  onChange={(e) => setUseCustomCarrier(e.target.value === 'custom')}
                  style={{ marginBottom: 8 }}
                >
                  <Radio value="preset">预置列表</Radio>
                  <Radio value="custom">其他 (手填)</Radio>
                </Radio.Group>
                {!useCustomCarrier ? (
                  <Select
                    placeholder="选运营商"
                    value={carrierId ?? undefined}
                    onChange={(v) => setCarrierId(v)}
                    style={{ width: '100%' }}
                    options={selectedCountry.telcos.map((t) => ({
                      value: t.id,
                      label: t.brand ? `${t.name} (${t.brand})` : t.name,
                    }))}
                  />
                ) : (
                  <Input
                    placeholder="例: XOX Mobile · ..."
                    value={customCarrierName}
                    onChange={(e) => setCustomCarrierName(e.target.value)}
                    maxLength={80}
                  />
                )}
              </>
            ) : (
              <Input
                placeholder="运营商名称 (手填)"
                value={customCarrierName}
                onChange={(e) => {
                  setCustomCarrierName(e.target.value);
                  setUseCustomCarrier(true);
                }}
                maxLength={80}
              />
            )}
          </div>

          {/* ICCID 尾号 */}
          <div>
            <div style={{ marginBottom: 6 }}>
              <Text strong>🔢 ICCID 尾号</Text>{' '}
              <Text type="secondary" style={{ fontSize: 12 }}>
                (选填 · 6-10 位 · 方便辨认是哪张卡)
              </Text>
            </div>
            <Input
              placeholder="例: 8847 或 898601234567"
              value={iccidSuffix}
              onChange={(e) => setIccidSuffix(e.target.value)}
              maxLength={10}
            />
          </div>

          {/* 备注 */}
          <div>
            <div style={{ marginBottom: 6 }}>
              <Text strong>📝 备注</Text>{' '}
              <Text type="secondary" style={{ fontSize: 12 }}>
                (选填 · 如: "Redmi 4 · 办公桌" · "OTP 专用")
              </Text>
            </div>
            <Input.TextArea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={200}
            />
          </div>

          {useCustomCountry && (
            <Alert
              type="info"
              showIcon
              message="未预置国家已记录"
              description="我们会统计租户手填的冷门国家, 下版本直接加入预置库. 感谢反馈!"
            />
          )}
        </Space>
      )}
    </Modal>
  );
}
