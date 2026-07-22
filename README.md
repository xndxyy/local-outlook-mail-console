# 本地 Outlook 取件台

这是对 `mail.chatai.codes` 工作流的本地安全复刻：在本机窗口里管理 Outlook 账号，并通过 Graph 或 IMAP 读取邮件结果。服务只监听 `127.0.0.1`，不把邮箱、密码或 token 发给第三方站点。

当前形态是 Windows 本地应用启动器：后台启动本地 Node 服务，前台用 Microsoft Edge 的独立 App 窗口承载界面。关闭窗口后，本地服务会自动停止。

## 安全边界

- 服务默认只监听 `127.0.0.1`，并拒绝非本机 Host。
- 推荐使用“Microsoft 登录”设备码流程授权，不需要复制 refresh token。
- 兼容导入格式：`账号----密码----client id----refresh token`；密码字段立即丢弃。
- 账号与授权凭据保存在 `%LOCALAPPDATA%\LocalOutlookMailConsole\data`，退出后不会清空。
- refresh token 使用本机随机密钥和 AES-256-GCM 加密，前端页面和取件请求不接触 token。
- “清空全部”会删除本机保存的账号数据。
- 导出功能只导出邮箱和已授权协议，不导出凭据。
- 邮件 HTML 详情使用 sandboxed iframe 隔离展示。
- 后端错误会对 refresh token、Bearer token、client secret 做脱敏。

## 协议兼容

- 默认只勾选 IMAP，Graph 需要手动开启。
- Microsoft 对 IMAP 与 Graph 分别授权；需要两种协议时，在应用中分别登录一次。
- 旧版导入的 Thunderbird refresh token 通常只有 IMAP scope，这类账号建议重新用 Microsoft 登录授权。
- Graph 优先尝试 Microsoft Entra v2 `consumers`，再尝试 `common` 和 v1 `common`。
- IMAP 会刷新 `https://outlook.office.com/IMAP.AccessAsUser.All` access token。
- 对旧 Outlook.com / Live token，IMAP 会回退到 `login.live.com` 的 `wl.imap wl.offline_access` scope。
- IMAP 认证固定使用 Thunderbird/Outlook 常见的 `AUTHENTICATE XOAUTH2` SASL 格式。
- IMAP 会自动尝试 `outlook.office365.com` 和 `imap-mail.outlook.com` 两个主机。
- IMAP 失败时会显示主机、token 来源、服务器响应和 OAuth 细节，不再只显示 `Command failed`。
- 如果出现 `User is authenticated but not connected`，通常要检查 Outlook 网页端的 IMAP 开关，或者临时优先走 IPv4 再试。

## 运行

```powershell
npm install
npm run desktop
```

也可以双击：

```text
desktop/本地Outlook取件台.cmd
```

便携包解压后，直接双击根目录的 `本地Outlook取件台.cmd`。包内已包含 Node 运行时和生产依赖。

调试网页模式：

```powershell
$env:PORT="4174"; npm start
```

然后打开：

```text
http://127.0.0.1:4174
```

## 测试

```powershell
npm test
```
