# `installer/assets/` · 品牌资源

## 期望文件

- `wahubx.ico` · Installer + 应用图标 · 256x256 + 128x128 + 64x64 + 32x32 + 16x16 多尺寸 ICO
  - Inno Setup 的 `SetupIconFile` + `UninstallDisplayIcon` 指向
  - Windows 桌面快捷方式 + 开始菜单图标引用
  - **Day 1.5 不交付** · 由产品方提供 ICO 文件 · 建议 WhatsApp 绿 #25d366 主色

## 临时占位

Day 1.5 未提供 ICO 文件. 构建时 Inno Setup 会报 `SetupIconFile doesn't exist`:
- **开发期**: 注释掉 `.iss` 的 `SetupIconFile=` 行 · 或放任意 .ico 在此目录
- **发布前**: 必须替换为正式品牌 ICO · build.bat 可加检查步骤

## 其他资源 (可选)

- `banner.bmp` · Inno Setup 向导顶部横幅 · 164x314 BMP
- `header.bmp` · Inno Setup 向导小横幅 · 55x58 BMP
- 当前 `.iss` 未引用, 按需加 `WizardImageFile=` / `WizardSmallImageFile=` 字段启用
