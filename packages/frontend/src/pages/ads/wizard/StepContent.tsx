import { useEffect, useState } from 'react';
import { Alert, Card, Checkbox, Empty, Radio, Space, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleFilled, StopOutlined, SwapOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { adsApi, openingLinesApi, type Advertisement, type OpeningLine } from '@/lib/campaigns-api';
import { AdStrategy, OpeningStrategy } from '@/lib/campaigns-api';
import { useWizard } from './WizardContext';
import { CardTitle, CardIcons, CARD_STYLE, BRAND, BRAND_SOFT } from './shared';

// 2026-04-24 · Step 2 · 广告内容 + 开场方式 · 重设计用 SelectableCard 风格

function PickerCard({
  checked,
  onToggle,
  title,
  badge,
  description,
  footer,
}: {
  checked: boolean;
  onToggle: () => void;
  title: string;
  badge?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        border: checked ? `2px solid ${BRAND}` : '1px solid #e0e0e0',
        background: checked ? BRAND_SOFT : '#fff',
        borderRadius: 8,
        padding: checked ? '13px 15px' : '14px 16px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
      onMouseEnter={(e) => {
        if (!checked) (e.currentTarget.style.borderColor = '#8ee2ad');
      }}
      onMouseLeave={(e) => {
        if (!checked) (e.currentTarget.style.borderColor = '#e0e0e0');
      }}
    >
      <Checkbox checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
          {badge}
        </div>
        {description && (
          <div
            style={{
              whiteSpace: 'pre-wrap',
              color: '#555',
              fontSize: 12,
              lineHeight: 1.55,
              maxHeight: 58,
              overflow: 'hidden',
            }}
          >
            {description}
          </div>
        )}
        {footer && (
          <div style={{ marginTop: 4, fontSize: 11, color: '#999' }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

// 大选项卡 (用在"开场模式"选 固定 / 随机 / 不加)
function ModeBigCard({
  icon,
  title,
  description,
  active,
  recommend,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  active: boolean;
  recommend?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        flex: 1,
        border: active ? `2px solid ${BRAND}` : '1px solid #e0e0e0',
        background: active ? BRAND_SOFT : '#fff',
        borderRadius: 8,
        padding: active ? '15px 15px 14px 15px' : '16px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        textAlign: 'center',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget.style.borderColor = '#8ee2ad');
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget.style.borderColor = '#e0e0e0');
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          marginBottom: 4,
        }}
      >
        <Radio checked={active} onChange={onClick} onClick={(e) => e.stopPropagation()} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        {recommend && (
          <span
            style={{
              padding: '1px 6px',
              background: BRAND_SOFT,
              color: BRAND,
              border: '1px solid #b7eb8f',
              borderRadius: 3,
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            推荐
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5, padding: '0 4px' }}>
        {description}
      </div>
      <div style={{ marginTop: 12, fontSize: 22, color: active ? BRAND : '#d9d9d9' }}>{icon}</div>
    </div>
  );
}

export function StepContent() {
  const { draft, patch } = useWizard();
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [openings, setOpenings] = useState<OpeningLine[]>([]);

  useEffect(() => {
    void adsApi.list().then(setAds).catch(() => undefined);
    void openingLinesApi.list().then(setOpenings).catch(() => undefined);
  }, []);

  const toggleAd = (id: number) => {
    if (draft.adStrategy === AdStrategy.Single) {
      patch({ adIds: [id] });
    } else {
      const set = new Set(draft.adIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      patch({ adIds: [...set] });
    }
  };

  const toggleOpening = (id: number) => {
    if (draft.openingStrategy === OpeningStrategy.Fixed) {
      patch({ openingIds: [id] });
    } else {
      const set = new Set(draft.openingIds);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      patch({ openingIds: [...set] });
    }
  };

  const setOpeningStrategy = (mode: OpeningStrategy) => {
    const ids =
      mode === OpeningStrategy.Fixed
        ? draft.openingIds.slice(0, 1)
        : mode === OpeningStrategy.None
          ? []
          : draft.openingIds;
    patch({ openingStrategy: mode, openingIds: ids });
  };

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      {/* 广告文案 */}
      <Card size="small" style={CARD_STYLE} title={<CardTitle icon={CardIcons.adContent}>广告文案</CardTitle>}>
        <Radio.Group
          value={draft.adStrategy}
          onChange={(e) => {
            const mode = e.target.value as AdStrategy;
            patch({
              adStrategy: mode,
              adIds: draft.adIds.slice(0, mode === AdStrategy.Single ? 1 : draft.adIds.length),
            });
          }}
        >
          <Radio value={AdStrategy.Single}>单一广告</Radio>
          <Radio value={AdStrategy.Rotation}>多广告轮换</Radio>
        </Radio.Group>

        <div style={{ marginTop: 12 }}>
          {ads.length === 0 ? (
            <Empty
              description={
                <Space direction="vertical" size={4}>
                  <span>还没有广告文案</span>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    请先到 资源管理 → 广告文案 创建
                  </Typography.Text>
                </Space>
              }
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 12,
              }}
            >
              {ads.map((ad) => (
                <PickerCard
                  key={ad.id}
                  checked={draft.adIds.includes(ad.id)}
                  onToggle={() => toggleAd(ad.id)}
                  title={ad.name}
                  badge={
                    ad.assetId !== null ? (
                      <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
                        含素材
                      </Tag>
                    ) : undefined
                  }
                  description={ad.content}
                  footer={`最近修改: ${new Date(ad.updatedAt).toLocaleDateString('zh-CN')}`}
                />
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 开场白 */}
      <Card size="small" style={CARD_STYLE} title={<CardTitle icon={CardIcons.opening}>开场白</CardTitle>}>
        {/* 步骤 1 · 选择开场模式 */}
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10, color: '#333' }}>
          步骤 1 · 选择开场模式
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <ModeBigCard
            icon={<CheckCircleFilled />}
            title="固定开场 (选 1 条)"
            description="每次发送相同的开场白"
            active={draft.openingStrategy === OpeningStrategy.Fixed}
            onClick={() => setOpeningStrategy(OpeningStrategy.Fixed)}
          />
          <ModeBigCard
            icon={<SwapOutlined />}
            title="随机开场"
            description="从已选文案中随机发送 · 更自然"
            active={draft.openingStrategy === OpeningStrategy.Random}
            recommend
            onClick={() => setOpeningStrategy(OpeningStrategy.Random)}
          />
          <ModeBigCard
            icon={<StopOutlined />}
            title="不加开场"
            description="直接发送广告正文"
            active={draft.openingStrategy === OpeningStrategy.None}
            onClick={() => setOpeningStrategy(OpeningStrategy.None)}
          />
        </div>

        {/* 步骤 2 · 选择开场文案 */}
        {draft.openingStrategy !== OpeningStrategy.None && (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: '#333' }}>
                步骤 2 · 选择开场文案
              </span>
              {openings.length > 0 && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  已选 {draft.openingIds.length}/{openings.length}
                  {draft.openingStrategy === OpeningStrategy.Random && ' (至少选 2 条)'}
                  {draft.openingStrategy === OpeningStrategy.Fixed && ' (选 1 条)'}
                </Typography.Text>
              )}
            </div>

            {openings.length === 0 ? (
              <Empty
                description={
                  <Space direction="vertical" size={4}>
                    <span>还没有开场白</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      请先到 资源管理 → 开场白 创建
                    </Typography.Text>
                  </Space>
                }
              />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                  gap: 10,
                }}
              >
                {openings.map((o) => {
                  const selected = draft.openingIds.includes(o.id);
                  return (
                    <Tooltip
                      key={o.id}
                      title={
                        o.aiEnabled && (o.variants?.length ?? 0) > 0
                          ? `含 ${o.variants.length} 条 AI 变体 · 发送时随机抽`
                          : undefined
                      }
                    >
                      <div>
                        <PickerCard
                          checked={selected}
                          onToggle={() => toggleOpening(o.id)}
                          title={o.name}
                          badge={
                            o.aiEnabled && (o.variants?.length ?? 0) > 0 ? (
                              <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>
                                AI ·{o.variants.length}
                              </Tag>
                            ) : undefined
                          }
                          description={o.content}
                        />
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            )}

            {/* 底部提示 */}
            {draft.openingStrategy === OpeningStrategy.Random && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 12, fontSize: 12 }}
                message="随机开场建议选 2 条及以上, 这样对陌生客户更像真人多样化"
              />
            )}
          </>
        )}
      </Card>

      {/* 整体错误提示 */}
      {draft.adIds.length === 0 && (
        <Alert type="warning" showIcon message="请至少选择 1 条广告" />
      )}
      {draft.adStrategy === AdStrategy.Rotation && draft.adIds.length === 1 && (
        <Alert type="warning" showIcon message="多广告轮换建议选 2 条及以上" />
      )}
    </Space>
  );
}
