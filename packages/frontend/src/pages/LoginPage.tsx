import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { api, extractErrorMessage } from '@/lib/api';

const { Title, Text } = Typography;

interface BootstrapInfo {
  fresh_install: boolean;
  platform_admin_exists: boolean;
  license_activated: boolean;
  app_version: string;
}

interface LoginFormValues {
  email: string;
  password: string;
}

export function LoginPage() {
  const { login, licenseStatus } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bootstrap, setBootstrap] = useState<BootstrapInfo | null>(null);

  // M11 补强 1 · 首屏调 /version/bootstrap (public endpoint) · 显版本号 + 诊断
  // 不影响 RouteGate 跳转 (已由 licenseStatus 决定) · 仅提供透明诊断
  useEffect(() => {
    api
      .get<BootstrapInfo>('/version/bootstrap')
      .then((res) => setBootstrap(res.data))
      .catch(() => {
        // backend 未起 / 返 404 (未升级到 M11 Day 3) → 静默, 不阻塞登录
      });
  }, []);

  const handleFinish = async (values: LoginFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      await login(values);
      const from = (location.state as { from?: { pathname?: string } })?.from?.pathname ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err, '登录失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ marginBottom: 4 }}>WAhubX 登录</Title>
          {licenseStatus?.tenantName && (
            <Text type="secondary">
              {licenseStatus.tenantName} · {licenseStatus.plan?.toUpperCase()} · {licenseStatus.slotLimit} 槽
            </Text>
          )}
          {bootstrap && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#999' }}>
              v{bootstrap.app_version}
              {!bootstrap.platform_admin_exists && (
                <Text type="warning" style={{ marginLeft: 8 }}>⚠ 无平台超管 · 请走激活流程</Text>
              )}
            </div>
          )}
        </div>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form<LoginFormValues>
          layout="vertical"
          onFinish={handleFinish}
          autoComplete="off"
          requiredMark={false}
        >
          <Form.Item
            label="邮箱"
            name="email"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式错误' },
            ]}
          >
            <Input placeholder="admin@example.com" autoFocus size="large" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password placeholder="••••••••" size="large" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block size="large">
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
