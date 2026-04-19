import { Card, Col, Descriptions, Row, Statistic, Tag } from 'antd';
import { useAuth } from '@/auth/AuthContext';

export function DashboardPage() {
  const { user, licenseStatus } = useAuth();
  if (!user || !licenseStatus) return null;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card title="租户信息">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="名称">{licenseStatus.tenantName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="套餐">
                <Tag color="green">{licenseStatus.plan?.toUpperCase() ?? '—'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="槽位上限">{licenseStatus.slotLimit ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="License">
                <code>{licenseStatus.licenseKey ?? '—'}</code>
              </Descriptions.Item>
              <Descriptions.Item label="到期时间">
                {licenseStatus.expiresAt ? new Date(licenseStatus.expiresAt).toLocaleDateString('zh-CN') : '永久'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="当前用户">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="邮箱">{user.email}</Descriptions.Item>
              <Descriptions.Item label="用户名">{user.username}</Descriptions.Item>
              <Descriptions.Item label="姓名">{user.fullName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="角色">
                <Tag color={user.role === 'admin' ? 'red' : user.role === 'operator' ? 'blue' : 'default'}>
                  {user.role.toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="租户 ID">{user.tenantId ?? '平台超管'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col span={24}>
          <Card title="M1 脚手架状态">
            <Row gutter={16}>
              <Col span={6}><Statistic title="后端" value="已就绪" valueStyle={{ color: '#3f8600' }} /></Col>
              <Col span={6}><Statistic title="数据库" value="已就绪" valueStyle={{ color: '#3f8600' }} /></Col>
              <Col span={6}><Statistic title="认证" value="已就绪" valueStyle={{ color: '#3f8600' }} /></Col>
              <Col span={6}><Statistic title="License" value="已激活" valueStyle={{ color: '#3f8600' }} /></Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
