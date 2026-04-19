import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { extractErrorMessage } from '@/lib/api';

const { Title, Paragraph, Text } = Typography;

interface ActivateFormValues {
  licenseKey: string;
  adminEmail: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName?: string;
}

export function ActivatePage() {
  const { activate, licenseStatus } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleFinish = async (values: ActivateFormValues) => {
    setError(null);
    setSubmitting(true);
    try {
      await activate(values);
      navigate('/', { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err, '激活失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: 24, background: '#f5f5f5' }}>
      <Card style={{ width: 520 }}>
        <Title level={3} style={{ marginBottom: 4 }}>激活 WAhubX</Title>
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          输入管理员发给你的 License Key, 并设置首个管理员账号. 该 License 将绑定到这台机器, 无法转移.
        </Paragraph>
        {licenseStatus?.machineId && (
          <Paragraph style={{ marginBottom: 16 }}>
            <Text type="secondary">本机指纹: </Text>
            <Text code>{licenseStatus.machineId}</Text>
          </Paragraph>
        )}
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form<ActivateFormValues>
          layout="vertical"
          onFinish={handleFinish}
          autoComplete="off"
          requiredMark={false}
        >
          <Form.Item
            label="License Key"
            name="licenseKey"
            rules={[{ required: true, message: '请输入 License Key' }]}
          >
            <Input placeholder="WA-XXXX-XXXX-XXXX-XXXX" size="large" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item
            label="管理员邮箱"
            name="adminEmail"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式错误' },
            ]}
          >
            <Input placeholder="admin@example.com" size="large" />
          </Form.Item>
          <Form.Item
            label="用户名"
            name="adminUsername"
            rules={[
              { required: true, message: '请输入用户名' },
              { pattern: /^[a-zA-Z0-9_]+$/, message: '只能包含字母、数字和下划线' },
              { min: 3, message: '至少 3 个字符' },
            ]}
          >
            <Input placeholder="admin" size="large" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="adminPassword"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
          >
            <Input.Password placeholder="至少 8 位" size="large" />
          </Form.Item>
          <Form.Item label="姓名 (选填)" name="adminFullName">
            <Input placeholder="张三" size="large" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block size="large">
              激活并登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
