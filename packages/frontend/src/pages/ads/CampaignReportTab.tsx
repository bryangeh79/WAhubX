// 2026-04-24 · 投放结果报告 · drawer 第 4 tab
// 总览 · 号表现 · 文案表现 · 失败分类 · 时段分布 · 导出 CSV
import { useEffect, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Progress,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { campaignsApi, type CampaignReport } from '@/lib/campaigns-api';
import { extractErrorMessage } from '@/lib/api';

const BRAND = '#25d366';

interface Props {
  campaignId: number;
  active: boolean; // tab 激活时才加载 (省请求)
}

export function CampaignReportTab({ campaignId, active }: Props) {
  const { message } = App.useApp();
  const [report, setReport] = useState<CampaignReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setReport(await campaignsApi.report(campaignId));
    } catch (err) {
      message.error(extractErrorMessage(err, '加载报告失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, active]);

  const exportFullCsv = async () => {
    try {
      const targets = await campaignsApi.listTargets(campaignId);
      const header = 'phone,slot_id,ad_id,opening_id,status,sent_at,error_code,error_msg';
      const statusMap: Record<number, string> = {
        0: 'pending',
        1: 'dispatched',
        2: 'sent',
        3: 'failed',
        4: 'skipped',
      };
      const lines = targets.map((t) =>
        [
          t.phoneE164,
          t.assignedSlotId ?? '',
          t.adId ?? '',
          t.openingId ?? '',
          statusMap[t.status] ?? t.status,
          t.sentAt ? new Date(t.sentAt).toLocaleString('zh-CN', { hour12: false }) : '',
          t.errorCode ?? '',
          (t.errorMsg ?? '').replace(/[\r\n,]/g, ' '),
        ]
          .map((v) => String(v))
          .join(','),
      );
      const csv = '\ufeff' + [header, ...lines].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const name = (report?.campaignName ?? `campaign-${campaignId}`).replace(/[\\/:*?"<>|]/g, '_');
      a.download = `${name}-targets-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      message.success(`已导出 ${targets.length} 行`);
    } catch (err) {
      message.error(extractErrorMessage(err, '导出失败'));
    }
  };

  if (loading) return <Spin style={{ display: 'block', padding: 40 }} />;
  if (!report)
    return (
      <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>
        还没有报告数据 · <Button type="link" onClick={load}>加载</Button>
      </div>
    );

  const { overall, timing, slotPerformance, adPerformance, errorBreakdown, hourlyDistribution } = report;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {timing.firstSent && timing.lastSent
            ? `执行 · ${new Date(timing.firstSent).toLocaleString('zh-CN', { hour12: false })} → ${new Date(timing.lastSent).toLocaleString('zh-CN', { hour12: false })} · 时长 ${formatDuration(timing.durationMs)}`
            : '尚未开始发送'}
        </Typography.Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} size="small">
            刷新
          </Button>
          <Button
            icon={<DownloadOutlined />}
            type="primary"
            size="small"
            onClick={exportFullCsv}
            style={{ background: BRAND, borderColor: BRAND }}
          >
            导出 CSV
          </Button>
        </Space>
      </div>

      {/* 总览 */}
      <Card size="small" title="总览">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12,
            textAlign: 'center',
          }}
        >
          <Stat label="总目标" value={overall.planned} color="#555" />
          <Stat label="成功" value={overall.sent} color={BRAND} />
          <Stat label="失败" value={overall.failed} color="#f5222d" />
          <Stat label="跳过" value={overall.skipped} color="#fa8c16" />
          <Stat label="成功率" value={`${overall.successRate}%`} color={BRAND} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Progress
            percent={
              overall.planned > 0
                ? Math.round((overall.doneCount / overall.planned) * 100)
                : 0
            }
            strokeColor={{ from: BRAND, to: '#13c2c2' }}
            format={(p) => `${overall.doneCount}/${overall.planned} (${p}%)`}
          />
        </div>
      </Card>

      {/* 客户反馈 · Z 方案 */}
      <Card
        size="small"
        title={
          <Space>
            <span>💬 客户反馈</span>
            <Tooltip title="系统监听所有入站消息, 匹配 7 天内发过广告的号码, 自动标记为 '已回复'">
              <Tag color="default" style={{ fontSize: 11 }}>
                7 天窗口归因
              </Tag>
            </Tooltip>
          </Space>
        }
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12,
            textAlign: 'center',
          }}
        >
          <Stat label="已回复客户" value={overall.replied} color="#1677ff" />
          <Stat label="累计回复条数" value={overall.totalReplies} color="#722ed1" />
          <Stat
            label="回复率"
            value={`${overall.replyRate}%`}
            color={overall.replyRate >= 5 ? BRAND : overall.replyRate >= 2 ? '#fa8c16' : '#8c8c8c'}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            📌 行业参考: 陌生客户冷启 2-5% 算正常, 5-15% 算好, &gt;15% 属于优质文案 · 打开详情 "目标" tab 按 "已回复" 筛选可看具体回复的客户
          </Typography.Text>
        </div>
      </Card>

      {/* 账号表现 */}
      <Card size="small" title={`账号表现 (${slotPerformance.length} 个号)`}>
        {slotPerformance.length === 0 ? (
          <Typography.Text type="secondary">暂无数据</Typography.Text>
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey="slotId"
            dataSource={slotPerformance}
            columns={[
              { title: '槽位', dataIndex: 'slotIndex', width: 60, render: (v: number) => <Tag>#{v}</Tag> },
              {
                title: '号码',
                dataIndex: 'phoneNumber',
                render: (v: string | null) => (v ? maskPhone(v) : <Typography.Text type="secondary">—</Typography.Text>),
              },
              { title: '分配', dataIndex: 'assigned', width: 70, align: 'right' },
              {
                title: '成功',
                dataIndex: 'sent',
                width: 70,
                align: 'right',
                render: (v: number) => <span style={{ color: BRAND, fontWeight: 600 }}>{v}</span>,
              },
              {
                title: '失败',
                dataIndex: 'failed',
                width: 70,
                align: 'right',
                render: (v: number) => (v > 0 ? <span style={{ color: '#f5222d' }}>{v}</span> : v),
              },
              {
                title: '成功率',
                dataIndex: 'successRate',
                width: 130,
                render: (v: number) => (
                  <Progress
                    percent={v}
                    size="small"
                    strokeColor={v >= 90 ? BRAND : v >= 70 ? '#fa8c16' : '#f5222d'}
                    format={(p) => `${p}%`}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>

      {/* 文案表现 */}
      <Card size="small" title={`文案表现 (${adPerformance.length} 条)`}>
        {adPerformance.length === 0 ? (
          <Typography.Text type="secondary">暂无数据</Typography.Text>
        ) : (
          <Table
            size="small"
            pagination={false}
            rowKey="adId"
            dataSource={adPerformance}
            columns={[
              { title: '文案', dataIndex: 'adName', ellipsis: true },
              { title: '用量', dataIndex: 'used', width: 80, align: 'right' },
              {
                title: '成功',
                dataIndex: 'sent',
                width: 80,
                align: 'right',
                render: (v: number) => <span style={{ color: BRAND, fontWeight: 600 }}>{v}</span>,
              },
              {
                title: '失败',
                dataIndex: 'failed',
                width: 80,
                align: 'right',
                render: (v: number) => (v > 0 ? <span style={{ color: '#f5222d' }}>{v}</span> : v),
              },
              {
                title: '成功率',
                dataIndex: 'successRate',
                width: 130,
                render: (v: number) => (
                  <Progress
                    percent={v}
                    size="small"
                    strokeColor={v >= 90 ? BRAND : v >= 70 ? '#fa8c16' : '#f5222d'}
                    format={(p) => `${p}%`}
                  />
                ),
              },
            ]}
          />
        )}
      </Card>

      {/* 时段分布 */}
      {hourlyDistribution.length > 0 && (
        <Card size="small" title="时段分布 (MY 时区)">
          <HourlyBar data={hourlyDistribution} />
        </Card>
      )}

      {/* 失败分类 */}
      {errorBreakdown.length > 0 && (
        <Card size="small" title={`失败原因 (${errorBreakdown.reduce((s, e) => s + e.count, 0)} 次)`}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {errorBreakdown.map((e) => (
              <div
                key={e.code}
                style={{
                  padding: '8px 12px',
                  background: '#fff2f0',
                  border: '1px solid #ffccc7',
                  borderRadius: 6,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Tag color="error">{e.code}</Tag>
                  {e.sampleMsg && (
                    <Tooltip title={e.sampleMsg}>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 12, marginLeft: 4 }}
                        ellipsis
                      >
                        {e.sampleMsg.slice(0, 60)}
                      </Typography.Text>
                    </Tooltip>
                  )}
                </div>
                <span style={{ fontWeight: 600, color: '#f5222d' }}>{e.count} 次</span>
              </div>
            ))}
          </Space>
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 8 }}
            message="号码硬失败 (443 / invalid jid) 会自动标记为坏号, 下次同群投放自动跳过"
          />
        </Card>
      )}
    </Space>
  );
}

// ─── 小组件 ───────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#888' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color, lineHeight: 1.1, marginTop: 4 }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function HourlyBar({ data }: { data: Array<{ hour: number; count: number }> }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
      {data.map((d) => {
        const h = Math.round((d.count / max) * 100);
        return (
          <Tooltip key={d.hour} title={`${String(d.hour).padStart(2, '0')}:00 · ${d.count} 条`}>
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                <div
                  style={{
                    width: '100%',
                    height: `${h}%`,
                    background: `linear-gradient(to top, ${BRAND}, #13c2c2)`,
                    borderRadius: '3px 3px 0 0',
                  }}
                />
              </div>
              <div style={{ fontSize: 10, color: '#888' }}>{String(d.hour).padStart(2, '0')}</div>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${m}m`;
  return `${m} min`;
}

function maskPhone(p: string): string {
  if (!p || p.length < 7) return p;
  return `${p.slice(0, 4)}***${p.slice(-3)}`;
}
