; ============================================================
; WAhubX Installer - Inno Setup Script
; ============================================================
; 改编自 FAhubX/installer/fahubx-setup.iss (main 分支 · 2026-04 前稳定版)
;   - 砍 Cloud 部署模式 · WAhubX V1 本地桌面 only
;   - 砍 Puppeteer/Chromium staging · M9 已砍双模式
;   - 加 M11 补强 2 · Uninstall 默认保 data + backups
;
; Build: iscc.exe wahubx-setup.iss
; Requires: Inno Setup 6.x (https://jrsoftware.org/isinfo.php)
; ============================================================

#define MyAppName "WAhubX"
#define MyAppVersion "0.11.0-m11"
#define MyAppPublisher "WAhubX"
#define MyAppURL "https://github.com/bryangeh79/WAhubX"
#define MyAppExeName "wahubx.bat"

[Setup]
; 独立 UUID · 区别于 FAhubX · 防同机共存互相卸载
AppId={{7A9F3C21-4B6D-4E8A-9F2C-8D7E3B1A4F5E}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName=C:\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=output
; 版本号进文件名 (无 Code Signing · 方便用户识别版本 · CHANGELOG 记录)
OutputBaseFilename=WAhubX-Setup-v{#MyAppVersion}
SetupIconFile=assets\wahubx.ico
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Win10 1809+ · Win11 兼容
MinVersion=10.0.17763
WizardStyle=modern
DisableProgramGroupPage=yes
LicenseFile=
UninstallDisplayIcon={app}\assets\wahubx.ico

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; ========================================================================
; Day 1.5 · 仅骨架. Day 3-4 填真 staging 内容:
;   - staging\node\*        portable Node 20 LTS (build.bat 下载 + 复制)
;   - staging\pgsql\*       PostgreSQL 16 portable
;   - staging\redis\*       Redis for Windows
;   - staging\backend\*     backend obfuscate + compiled
;   - staging\frontend\*    frontend Vite build
; ========================================================================

; Node.js runtime (M11 Day 3-4 填)
Source: "staging\node\*"; DestDir: "{app}\app\node"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: StagingExists('node')

; PostgreSQL portable
Source: "staging\pgsql\*"; DestDir: "{app}\app\pgsql"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: StagingExists('pgsql')

; Redis for Windows
Source: "staging\redis\*"; DestDir: "{app}\app\redis"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: StagingExists('redis')

; Backend (compiled + obfuscated)
Source: "staging\backend\*"; DestDir: "{app}\app\backend"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: StagingExists('backend')

; Frontend (Vite dist)
Source: "staging\frontend\*"; DestDir: "{app}\app\frontend"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: StagingExists('frontend')

; Service scripts (Day 3 补全)
Source: "scripts\start.bat"; DestDir: "{app}"; Flags: ignoreversion; Check: FileExists(ExpandConstant('{src}\scripts\start.bat'))
Source: "scripts\stop.bat"; DestDir: "{app}"; Flags: ignoreversion; Check: FileExists(ExpandConstant('{src}\scripts\stop.bat'))
Source: "scripts\wahubx.bat"; DestDir: "{app}"; Flags: ignoreversion; Check: FileExists(ExpandConstant('{src}\scripts\wahubx.bat'))
Source: "scripts\redis.conf"; DestDir: "{app}\app\redis"; Flags: ignoreversion; Check: FileExists(ExpandConstant('{src}\scripts\redis.conf'))

; Helper scripts (M11 Day 3 实写)
Source: "scripts\init-db.bat"; DestDir: "{app}\scripts"; Flags: ignoreversion; Check: FileExists(ExpandConstant('{src}\scripts\init-db.bat'))
Source: "scripts\generate-env.js"; DestDir: "{app}\scripts"; Flags: ignoreversion; Check: FileExists(ExpandConstant('{src}\scripts\generate-env.js'))

; Brand assets (icon, README)
Source: "assets\wahubx.ico"; DestDir: "{app}\assets"; Flags: ignoreversion; Check: FileExists(ExpandConstant('{src}\assets\wahubx.ico'))

; M7 Day 1 · 债 1.2 · _builtin 素材 seed
; 放到 {app}\seeds\_builtin\ · init-db.bat 首次安装时拷到 {app}\data\assets\_builtin
; Day 2+ 升级时 seed 仍会覆盖 (但 init-db.bat 的 IF 守护 data/assets/_builtin 已存在则不覆盖)
Source: "staging\data\assets\_builtin\*"; DestDir: "{app}\seeds\_builtin"; Flags: ignoreversion recursesubdirs createallsubdirs; Check: DirExists(ExpandConstant('{src}\staging\data\assets\_builtin'))

[Dirs]
; data 目录用户数据 · uninstall 默认保留
Name: "{app}\data"; Permissions: users-full
; backups 目录 · 每日快照 / 手动 .wab / pre-migration / pre-import · uninstall 默认保留
Name: "{app}\backups"; Permissions: users-full
; logs 目录 · uninstall 强制清 (日志属临时)
Name: "{app}\logs"; Permissions: users-full
; app 目录 · 升级时被 .wupd 替换
Name: "{app}\app"; Permissions: users-full

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\assets\wahubx.ico"; Comment: "Start WAhubX"
Name: "{group}\Stop {#MyAppName}"; Filename: "{app}\stop.bat"; WorkingDir: "{app}"; IconFilename: "{app}\assets\wahubx.ico"; Comment: "Stop WAhubX services"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\assets\wahubx.ico"; Tasks: desktopicon; Comment: "Start WAhubX"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
; M11 补强 2 · Uninstall 清理选项 · 默认不勾 (保护用户数据)
Name: "clean_data"; Description: "卸载时同时清除所有数据和备份 (默认保留)"; GroupDescription: "卸载选项 · 慎选"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch WAhubX"; Flags: nowait postinstall skipifsilent shellexec

[UninstallRun]
; 先停服务
Filename: "{app}\stop.bat"; Parameters: ""; Flags: runhidden waituntilterminated; RunOnceId: "StopServices"; Check: FileExists(ExpandConstant('{app}\stop.bat'))

[UninstallDelete]
; 默认删: app/ 子目录 + logs + .env
; **保留**: data/ · backups/ · fp-*.txt (通过 data/ 保留)
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\logs"
Type: files; Name: "{app}\.env"
Type: files; Name: "{app}\wahubx.bat"
Type: files; Name: "{app}\start.bat"
Type: files; Name: "{app}\stop.bat"
; 仅当用户勾选 clean_data task 才删 data + backups
Type: filesandordirs; Name: "{app}\data"; Tasks: clean_data
Type: filesandordirs; Name: "{app}\backups"; Tasks: clean_data

[Code]
var
  PortConfigPage: TWizardPage;
  AppPortEdit: TNewEdit;
  PgPortEdit: TNewEdit;
  RedisPortEdit: TNewEdit;

// Pascal helper · staging 子目录存在性检查 (让 Day 1.5 骨架能编译通过)
function StagingExists(Subdir: String): Boolean;
begin
  Result := DirExists(ExpandConstant('{src}\staging\' + Subdir));
end;

procedure InitializeWizard();
var
  AppPortLabel, PgPortLabel, RedisPortLabel, PortInfoLabel: TNewStaticText;
begin
  PortConfigPage := CreateCustomPage(wpSelectDir,
    '端口配置', 'Configure service ports · WAhubX backend + PostgreSQL + Redis');

  PortInfoLabel := TNewStaticText.Create(PortConfigPage);
  PortInfoLabel.Parent := PortConfigPage.Surface;
  PortInfoLabel.Caption := '选择 WAhubX 使用的端口.'#13#10 +
    '若与其他程序冲突请修改.'#13#10 +
    'If a port is already in use on this machine, change it to avoid conflicts.';
  PortInfoLabel.Top := 5;
  PortInfoLabel.Left := 0;
  PortInfoLabel.AutoSize := True;

  AppPortLabel := TNewStaticText.Create(PortConfigPage);
  AppPortLabel.Parent := PortConfigPage.Surface;
  AppPortLabel.Caption := 'WAhubX 后端端口 (Web Port · default: 3000):';
  AppPortLabel.Top := 60;
  AppPortLabel.Left := 0;

  AppPortEdit := TNewEdit.Create(PortConfigPage);
  AppPortEdit.Parent := PortConfigPage.Surface;
  AppPortEdit.Top := 80;
  AppPortEdit.Left := 0;
  AppPortEdit.Width := 120;
  AppPortEdit.Text := '3000';

  PgPortLabel := TNewStaticText.Create(PortConfigPage);
  PgPortLabel.Parent := PortConfigPage.Surface;
  PgPortLabel.Caption := 'PostgreSQL Port (default: 5433):';
  PgPortLabel.Top := 115;
  PgPortLabel.Left := 0;

  PgPortEdit := TNewEdit.Create(PortConfigPage);
  PgPortEdit.Parent := PortConfigPage.Surface;
  PgPortEdit.Top := 135;
  PgPortEdit.Left := 0;
  PgPortEdit.Width := 120;
  PgPortEdit.Text := '5433';

  RedisPortLabel := TNewStaticText.Create(PortConfigPage);
  RedisPortLabel.Parent := PortConfigPage.Surface;
  RedisPortLabel.Caption := 'Redis Port (default: 6380):';
  RedisPortLabel.Top := 170;
  RedisPortLabel.Left := 0;

  RedisPortEdit := TNewEdit.Create(PortConfigPage);
  RedisPortEdit.Parent := PortConfigPage.Surface;
  RedisPortEdit.Top := 190;
  RedisPortEdit.Left := 0;
  RedisPortEdit.Width := 120;
  RedisPortEdit.Text := '6380';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PortConfigPage.ID then
  begin
    if (StrToIntDef(AppPortEdit.Text, 0) < 1024) or (StrToIntDef(AppPortEdit.Text, 0) > 65535) then
    begin
      MsgBox('WAhubX 后端端口必须在 1024-65535 之间.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if (StrToIntDef(PgPortEdit.Text, 0) < 1024) or (StrToIntDef(PgPortEdit.Text, 0) > 65535) then
    begin
      MsgBox('PostgreSQL 端口必须在 1024-65535 之间.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if (StrToIntDef(RedisPortEdit.Text, 0) < 1024) or (StrToIntDef(RedisPortEdit.Text, 0) > 65535) then
    begin
      MsgBox('Redis 端口必须在 1024-65535 之间.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
    if (AppPortEdit.Text = PgPortEdit.Text) or (AppPortEdit.Text = RedisPortEdit.Text) or (PgPortEdit.Text = RedisPortEdit.Text) then
    begin
      MsgBox('三个端口必须互不相同.', mbError, MB_OK);
      Result := False;
      Exit;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  NodeExe, GenEnvScript, InitDbScript, GenEnvParams: String;
begin
  if CurStep = ssPostInstall then
  begin
    NodeExe := ExpandConstant('{app}\app\node\node.exe');
    GenEnvScript := ExpandConstant('{app}\scripts\generate-env.js');
    InitDbScript := ExpandConstant('{app}\scripts\init-db.bat');

    // Day 1.5 骨架: 若 scripts 未备齐 (M11 Day 3 才写), 跳过 post-install 自动化
    if not FileExists(GenEnvScript) then
    begin
      MsgBox('Day 1.5 版本不含 generate-env.js · 按 Day 3-4 计划后续填. ' +
             '本次仅部署文件. 手动启动请见 README.', mbInformation, MB_OK);
      Exit;
    end;

    // Step 1: 生成 .env
    WizardForm.StatusLabel.Caption := 'Generating configuration...';
    GenEnvParams := '"' + GenEnvScript + '"' +
      ' --mode local' +
      ' --app-port ' + AppPortEdit.Text +
      ' --pg-port ' + PgPortEdit.Text +
      ' --redis-port ' + RedisPortEdit.Text +
      ' --install-dir "' + ExpandConstant('{app}') + '"';

    Exec(NodeExe, GenEnvParams, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
    if ResultCode <> 0 then
    begin
      MsgBox('FATAL: 配置生成失败 (code ' + IntToStr(ResultCode) + '). 安装中止.', mbCriticalError, MB_OK);
      Abort();
    end;

    // Step 2: 初始化数据库
    if FileExists(InitDbScript) then
    begin
      WizardForm.StatusLabel.Caption := 'Initializing database...';
      Exec(InitDbScript, '', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
      if ResultCode <> 0 then
      begin
        MsgBox('FATAL: 数据库初始化失败 (code ' + IntToStr(ResultCode) + '). 详见 logs\pgsql-init.log.', mbCriticalError, MB_OK);
        Abort();
      end;
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
  StopScript: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    StopScript := ExpandConstant('{app}\stop.bat');
    if FileExists(StopScript) then
    begin
      Exec(StopScript, '', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;
