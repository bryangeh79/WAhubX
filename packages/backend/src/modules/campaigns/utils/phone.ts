// 2026-04-23 · 规范化马来华语场景的手机号 · 主要场景: 粘贴 / CSV 导入号码
//
// 规则:
//   - 去除所有非数字字符
//   - 允许前缀 "+", 去掉后保留纯数字
//   - 允许开头 00 (国际接入码), 去掉
//   - 允许开头 0 (马来本地格式), 如 0186888168 → 加 60 前缀 → 60186888168
//   - 其他情况假定已经是国际段, 原样返回
//   - 长度 8-15 位, 超出视为非法
//
// 注: 本函数只做规范化, 不做国家归属判断.

export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  // 去掉非数字 · 保留前缀信号
  let s = raw.trim();
  if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/\D/g, '');
  if (!s) return null;

  // 00 国际接入码
  if (s.startsWith('00')) s = s.slice(2);

  // 本地格式 0xxx → 加 60 (马来)
  if (s.startsWith('0') && s.length >= 9 && s.length <= 11) {
    s = '60' + s.slice(1);
  }

  // 最终长度校验
  if (s.length < 8 || s.length > 15) return null;
  return s;
}

// 把 jid 拆成 phone · e.g. 60186888168@s.whatsapp.net → 60186888168
export function jidToPhone(jid: string): string | null {
  if (!jid) return null;
  const m = jid.match(/^(\d+)@/);
  return m ? m[1] : null;
}

// 把 phone 包成 WA personal jid
export function phoneToJid(phone: string): string {
  return `${phone}@s.whatsapp.net`;
}

// 解析"多行 / 逗号分隔 / 空格分隔"的号码文本 · 返回去重后的 e164 数组
export function parsePhoneBlob(raw: string): string[] {
  if (!raw) return [];
  const tokens = raw.split(/[,\s\n\r\t;]+/).map((t) => t.trim()).filter(Boolean);
  const uniq = new Set<string>();
  for (const t of tokens) {
    const norm = normalizePhone(t);
    if (norm) uniq.add(norm);
  }
  return [...uniq];
}
