# WAhubX Icon 设计规格

> 受众: 产品方设计师 · 或外包图标设计服务
> 最后更新: 2026-04-21 · Cascade [41]
> 触发: RELEASE-V1.0.md §0 + §2 `wahubx.ico` 硬 blocker

---

## 交付清单 · TL;DR

必交 3 份:

1. **`wahubx.ico`** · Windows 多尺寸 ICO 格式 · `installer/assets/wahubx.ico`
2. **`wahubx.png`** · 512×512 透明背景 PNG · 备用 (未来 web / 市场物料)
3. **源文件** · `.ai` / `.psd` / `.sketch` · 供未来微调 (放 design assets 仓库 · 非 git 代码仓)

---

## 所需 ICO 尺寸

单一 `wahubx.ico` 文件内嵌多分辨率:

| 尺寸 | 用途 | 备注 |
|---|---|---|
| **256 × 256** | Windows 10/11 Large icon view · installer Hero | 最大尺寸 · 细节丰富 |
| **128 × 128** | Medium icon view · About 对话框 | |
| **64 × 64** | File Explorer Tiles view | |
| **48 × 48** | Extra Large icon view · Start menu | |
| **32 × 32** | Small icon view · taskbar · list view | **关键尺寸** · 辨识率最敏感 |
| **16 × 16** | Title bar · Alt+Tab 缩略图 · file icon | **关键尺寸** · 极简 · 只保轮廓 |

所有尺寸**必须在同一 `.ico` 文件内** · 不是 6 个独立文件.

生成工具建议:
- **Inkscape** 免费 · export → ICO 插件
- **IcoFX** 付费但强大
- **online-convert.com** 在线 · 把 PNG 转多尺寸 ICO
- **Adobe Illustrator** + Icon plugin

---

## 设计语言

### 品牌色

- **主色 · WhatsApp 绿**: `#25d366` (0x25D366)
- **辅色 · 深绿**: `#128c7e` (对比度 · 小尺寸时用)
- **背景**: **透明** 或 白色 (分尺寸用)

### 视觉元素建议

让设计师从这几个方向选:

**方向 A · WhatsApp 扩展主题**
- 类 WhatsApp 气泡 + 加号 / 齿轮 / 多号叠加
- 强调"多号管理" 核心卖点
- 注意: **不用 WhatsApp 原 logo** · 会触碰商标 · 灵感借鉴即可

**方向 B · hub 中枢主题**
- 一个节点 + 多条线辐射 (代表中枢连接多账号)
- 辨识度高 · 小尺寸仍清晰
- 跟 "hubX" 名字呼应

**方向 C · 抽象 WX 字母组合**
- 字母 W + X 重叠 / 叠加
- 简洁 · 16×16 也看得清
- 最省 · 但个性弱

### 避免

- ❌ 使用 Meta / WhatsApp / Facebook 原 logo 或任何变体 (商标风险)
- ❌ 过于复杂的渐变 (16×16 糊)
- ❌ 超过 4 种颜色 (小尺寸视觉噪音)
- ❌ 细字母 / 细线 (16×16 消失)
- ❌ 使用 CC BY-NC / CC ND 许可的素材 (商业限制)
- ❌ AI 生成的 logo 若未验证版权归属 (Midjourney/DALL-E 商业用有争议)

### 推荐

- ✅ 矢量起始 · 每尺寸独立优化 (不是缩放)
- ✅ 16×16 必须**单独像素级调整** · 不能只是缩放
- ✅ 32×32 起 · 加 1-2 px 描边保证边缘清晰
- ✅ 深色背景 (暗模式) + 浅色背景 (亮模式) 都看得清

---

## 使用位置

| 位置 | 尺寸 | 文件 |
|---|---|---|
| installer `.exe` 可执行文件图标 | 16/32/48/256 | Inno Setup 会自动嵌入 `.ico` |
| Windows 桌面快捷方式 | 32/48/256 | installer 安装时创建 |
| `C:\WAhubX\` 应用目录本身的图标 | 32/256 | `wahubx-setup.iss` `[Icons]` 段配 |
| Admin UI favicon (浏览器 tab) | 16/32 | `packages/frontend/public/favicon.ico` (PNG 转也行) |
| 任务栏 / Start 菜单 · pinned | 32/48 | Windows 自动从 .exe 提取 |
| Windows toast 通知 (M11 SnoreToast) | 64/128 | notifier 配置指向 ICO |

---

## 文件放置

```
WAhubX/
├── installer/
│   └── assets/
│       └── wahubx.ico    ← 交付这里 · Inno Setup build.bat 会 copy 进 .exe
└── packages/
    └── frontend/
        └── public/
            └── favicon.ico    ← 可以是 wahubx.ico 的副本 · 或单独优化的 16/32 版
```

---

## 验收标准

交付后跑以下检查:

### 1. 文件校验

```powershell
# Windows 10/11 PowerShell
$ico = "installer/assets/wahubx.ico"
if (!(Test-Path $ico)) { Write-Error "文件不存在" }

# 文件大小 · 合理区间 10-200 KB
$size = (Get-Item $ico).Length
Write-Host "Size: $size bytes"
if ($size -lt 5000 -or $size -gt 300000) {
    Write-Warning "尺寸异常 · $size bytes"
}
```

### 2. 多分辨率内嵌检查

用 `IcoFX` 或 Windows 资源管理器打开 · 确认**至少 5 个尺寸**(256/128/64/32/16 · 48 可选) 都在.

### 3. 视觉 QA

把 ICO 放在:
- `C:\WAhubX\WAhubX.exe` 位置 (模拟 installer 后状态)
- 右键属性 · 看 32x32 图标
- Alt+Tab 切换 · 看 16x16 缩略
- 每个尺寸都可清晰辨认为 WAhubX (不是一坨模糊色)

### 4. 暗模式测试

Windows 10/11 切 Dark Mode · 任务栏图标应仍可见 (不被深色背景吞掉).

---

## 不包含的 (分开交付)

以下另行沟通 · 不在本 spec scope:

- **App 启动 splash screen** (大图 · 600×400) · V1.1 考虑
- **营销物料** (banner / social media) · 上线后单独做
- **Email 签名 logo** · 客服用
- **T-shirt / 咖啡杯 merchandise** · 若真发

---

## 参考素材 (同行启发)

- **Buffer** · https://buffer.com (简洁蓝 hub)
- **HubSpot** · 红 H 叠加 · 名字呼应
- **Zapier** · 橙 Z + 连接线
- **n8n** · 圆点连接拓扑

不要直接照抄. 灵感启发即可.

---

## 交付 timeline 建议

- **Day 1-2** · 设计师出 3 个方向 draft (PNG 256)
- **Day 3** · 产品方 + Claude 团队 review · 选 1 个方向
- **Day 4-5** · 优化细节 · 生成多尺寸 ICO
- **Day 6** · 验收 · 交付到 `installer/assets/wahubx.ico`

总周期 · 1 周.

---

_最后更新 2026-04-21 · Cascade [41] · 对齐 RELEASE-V1.0.md §0 + §2_
