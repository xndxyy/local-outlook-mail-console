# 本地 Outlook 取件台

在自己的电脑上管理已授权的 Outlook 邮箱，通过 **IMAP OAuth2 或 Microsoft Graph** 查询邮件、按条件筛选，并查看文本与 HTML 详情。

项目以本地工作流复刻为起点，参考 `mail.chatai.codes` 的使用流程；当前形态是 **Windows 本地启动器 + Node.js 服务 + Microsoft Edge 独立 App 窗口**，不是部署在第三方网站上的邮箱管理服务。

> **使用范围**：仅管理你本人拥有或已获授权的邮箱。界面和凭据存储在本机，授权与收信仍需要连接 Microsoft 服务；本地运行不等于完全离线，也不等于能够抵御具有本机文件访问权限的恶意程序。

## 能做什么

- 使用“Microsoft 登录”设备码流程为邮箱授权，不必手动复制 refresh token。
- 分别选择 IMAP 和 Graph 协议，查询单个或全部已导入邮箱。
- 按主题/正文关键词、发件人和数量筛选邮件，查看结果与详情。
- 兼容旧式批量导入，提供重复检查、错误提示、账户删除与清空。
- 导出邮箱和已授权协议列表，**不导出凭据**。
- 桌面窗口连接本地服务；窗口连接结束后，启动器会停止本次启动的后台服务。

本项目的接口用于读取邮件，不提供发信、云端同步或多用户托管承诺。

## 快速开始：从源码启动

需要：

- Windows 和已安装的 **Microsoft Edge 浏览器**。启动器查找的是 Edge 可执行文件，不能仅凭安装 WebView2 就假定可用。
- Node.js 与 npm；项目使用 ES modules、内置 `fetch` 和 `node:test`，但 [package.json](package.json) 尚未声明 `engines` 版本范围。
- 能访问 Microsoft 授权和相应邮件协议服务的网络。

```powershell
git clone https://github.com/xndxyy/local-outlook-mail-console.git
cd local-outlook-mail-console
npm ci
npm run desktop
```

也可在安装依赖后双击 [desktop/本地Outlook取件台.cmd](desktop/本地Outlook取件台.cmd)。

桌面启动器优先使用 `127.0.0.1:4173`；该端口被占用时会选择空闲端口。不要将服务公开到局域网或公网，也不要使用反向代理共享邮箱管理界面。

### 首次授权与取件

1. 点击 **Microsoft 登录**，选择需要授权的协议。
2. 在 Microsoft 页面核对设备码与权限请求，只批准你主动发起的登录。
3. 返回应用等待授权完成，选择邮箱和协议，按需填写筛选条件后取件。
4. 需要另一种协议时，再针对该协议授权一次。默认界面只勾选 IMAP。

Graph 和 IMAP 是分别授权的能力；有其中一种授权，不代表另一种一定可用。当前设备码实现使用代码中内置的公开客户端标识和个人账户授权入口，能否成功还取决于 Microsoft 的应用与账号策略，不保证所有租户和账号类型均兼容。

## 调试网页模式

只需要本地网页而不启动独立 Edge 窗口时：

```powershell
$env:HOST="127.0.0.1"
$env:PORT="4174"
npm start
```

打开 [http://127.0.0.1:4174](http://127.0.0.1:4174)。网页模式由你手动停止终端中的服务，不适用桌面启动器的自动退出流程。

## 凭据与本地数据

| 项目 | 当前处理方式 |
| --- | --- |
| 服务访问 | 默认监听 `127.0.0.1`，同时检查本机 Host 和来源地址 |
| 账号数据 | 默认保存在 `%LOCALAPPDATA%\LocalOutlookMailConsole\data`；程序退出不会自动清空 |
| refresh token | 由后端以本机随机密钥和 AES-256-GCM 加密保存 |
| 解密密钥 | 单独保存在本地账户文件旁；不是 Windows 凭据保险库或硬件隔离 |
| 前端列表与取件请求 | 使用账号标识，不返回或携带后端保存的 refresh token |
| 邮件 HTML | 通过 sandboxed iframe 展示，配合页面安全策略 |
| 错误处理 | 对已覆盖的 refresh token、Bearer token 和 client secret 格式做脱敏 |
| 清空全部 | 清空应用保存的账号记录，不等于撤销 Microsoft 授权或抹除全部日志 |

可用 `LOCAL_OUTLOOK_DATA_DIR` 改变数据根目录。不要上传数据文件、密钥、浏览器 profile 或原始错误日志；密文与密钥同时泄露时，本地加密不能保护凭据。需要撤销授权时，还应使用 Microsoft 提供的账户管理入口。

### 旧格式导入

兼容格式为：

```text
邮箱----密码字段----client id----refresh token
```

密码字段在解析后丢弃，不作为登录密码保存。原始导入文本本身仍含凭据，请只使用有权限的数据，不要把真实样例发到 Issue、截图或聊天中。优先选择 Microsoft 登录流程。

旧 Thunderbird refresh token 往往只有 IMAP 授权；这类导入不能被当作有效的 Graph 授权，需要按协议重新登录。

## 协议兼容与排查

- Graph 实现会尝试不同 Microsoft 授权端点；端点回退不保证不满足权限条件的 token 可以使用。
- IMAP 使用 OAuth2 / `AUTHENTICATE XOAUTH2`，尝试 `outlook.office365.com` 与 `imap-mail.outlook.com`；代码包含旧版 Outlook.com / Live scope 的兼容路径。
- 遇到 `User is authenticated but not connected`，先检查 Outlook 网页端的 IMAP 设置、协议授权与网络；必要时在受控环境排查 IPv4/IPv6 差异。
- 授权失败时重新发起对应协议的登录，不要通过关闭 TLS 校验、公开服务或粘贴未知来源 token 来绕过错误。
- 排障信息可能包含邮箱或服务器响应；提交反馈前仍需人工脱敏，不能把内置脱敏视为覆盖所有秘密的保证。

## 开发与打包

```powershell
npm test
```

测试脚本使用 Node.js 测试运行器，仓库包含导入解析、凭据存储、协议兼容、安全边界及启动器等测试。测试存在不代表真实 Microsoft 登录与收信已在你的环境通过。

便携包构建脚本是 [desktop/build-portable.ps1](desktop/build-portable.ps1)，会复制当前 Node 运行时和生产依赖，并重新生成仓库内的打包目录。取得可信便携包后，可双击包根目录的 `本地Outlook取件台.cmd`；README 不把脚本存在等同于已发布可下载的安装包。

```text
desktop/       Edge 启动器与 Windows 打包脚本
public/        本地界面、交互与样式
src/server/    本地服务、授权、Graph / IMAP 与凭据存储
src/shared/    导入解析和邮件工具
tests/         自动化测试
```

## 许可

当前仓库没有独立 `LICENSE` 文件。分发、修改或复用前，请确认代码及依赖的授权范围；Microsoft、Outlook 和 Edge 的相关权利归各自权利人所有。
