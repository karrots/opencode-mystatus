# opencode-mystatus

[![npm version](https://img.shields.io/npm/v/opencode-mystatus.svg)](https://www.npmjs.com/package/opencode-mystatus)
[![npm 总下载量](https://img.shields.io/npm/dt/opencode-mystatus)](https://www.npmjs.com/package/opencode-mystatus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[OpenCode](https://opencode.ai) 插件，用于查询多个 AI 平台的账号额度使用情况。

[English](./README.md)

![AI额度一键查](./assets/mystatus-banner-zh.jpeg)

## 支持的平台

| 平台           | 账号类型              | 数据来源                                       |
| -------------- | --------------------- | ---------------------------------------------- |
| OpenAI         | Plus / Team / Pro     | V2 服务端活动账号；V1 使用 `auth.json`          |
| 智谱 AI        | Coding Plan           | `~/.local/share/opencode/auth.json`            |
| Z.ai           | Coding Plan           | `~/.local/share/opencode/auth.json`            |
| Synthetic      | API Key               | V2 服务端活动账号；V1 使用 `auth.json`          |
| GitHub Copilot | Individual / Business | `~/.local/share/opencode/auth.json`            |
| Google Cloud   | Antigravity           | `~/.config/opencode/antigravity-accounts.json` |

## 安装

### 让 AI 帮你安装

将以下内容粘贴到任意 AI 代理（Claude Code、OpenCode、Cursor 等）：

```
Install the opencode-mystatus plugin by following: https://raw.githubusercontent.com/vbgate/opencode-mystatus/main/README.md
```

<details>
<summary><b>AI 代理安装指令</b></summary>

安装此插件需要执行以下步骤：

1. 从仓库根目录运行 `./load-local-plugin.sh`。

2. 确认 `~/.config/opencode/opencode.json` 中没有 `plugin` 数组里的 `"opencode-mystatus"`，也没有 `command.mystatus` 配置。

3. 告诉用户完全退出并重启 OpenCode。

</details>

### 本地安装

从仓库根目录运行：

```bash
./load-local-plugin.sh
```

脚本会将 `plugin/mystatus.ts` 和 `plugin/lib/*.ts` 复制到 `~/.config/opencode/plugins`，OpenCode 会自动发现该目录下的本地 `*.ts` 插件。脚本也会清理旧的 `~/.config/opencode/plugin` 和 `~/.config/opencode/command` 文件。

本地开发时不要在 `plugin` 数组中添加 `"opencode-mystatus"`，也不要手动配置 `command.mystatus`。插件会自行注册 `/mystatus` 命令。

复制完成后完全退出并重启 OpenCode。

## 使用方法

### 方式一：斜杠命令

使用 `/mystatus` 命令获取完整的额度信息：

```
/mystatus
```

`/mystatus` 是本地命令，不会作为提示词发送给 LLM。

## 输出示例

```
## OpenAI 账号额度

Account:        user@example.com (team)

3小时限额
██████████████████████████████ 剩余 85%
重置: 2小时30分钟后

## 智谱 AI 账号额度

Account:        9c89****AQVM (Coding Plan)

5 小时 Token 限额
██████████████████████████████ 剩余 95%
已用: 0.5M / 10.0M
重置: 4小时后

## Z.ai 账号额度

Account:        9c89****AQVM (Z.ai)

5 小时 Token 限额
██████████████████████████████ 剩余 95%
已用: 0.5M / 10.0M
重置: 4小时后

## GitHub Copilot Account Quota

Account:        GitHub Copilot (individual)

Premium        ████░░░░░░░░░░░░░░░░ 24% (229/300)

Quota resets: 19d 0h (2026-02-01)

## Google Cloud 账号额度

### user@gmail.com

G3 Pro     4h 59m     ████████████████████ 100%
G3 Image   4h 59m     ████████████████████ 100%
G3 Flash   4h 59m     ████████████████████ 100%
Claude     2d 9h      ░░░░░░░░░░░░░░░░░░░░ 0%
```

## 功能特性

- 一条命令查询多个 AI 平台的额度使用情况
- 可视化进度条显示剩余额度
- 重置时间倒计时
- 多语言支持（中文 / 英文）
- 支持多个 Google Cloud 账号
- API Key 脱敏显示，保护安全

## 配置

**OpenCode V2 的 OpenAI 和 Synthetic：** 插件使用服务端的活动账号。OpenAI 需要 ChatGPT OAuth；Synthetic 使用 API Key。在 TUI 中运行 `/connect`，选择 **Synthetic**，按提示输入 API Key。已连接时可在账号列表中添加或切换活动账号。

也可以在终端中交互式输入：

```bash
opencode auth login synthetic --method key
```

密钥由 OpenCode 保存在服务端认证存储中。MyStatus 每次刷新都会解析当前活动账号，在服务端查询额度，只向 TUI 返回额度数据，不需要创建插件专用密钥文件或手动修改 `auth.json`。已有 V2 连接无需重新输入密钥。切换账号后会在下一次侧栏刷新（最多 60 秒）或运行 `/mystatus` 时更新。更新插件后需要重新加载服务端和 TUI 插件。

其他认证来源：

- **OpenCode V1 的 OpenAI 和 Synthetic，以及智谱 AI、Z.ai、GitHub Copilot**: `~/.local/share/opencode/auth.json`
- **Google Cloud**: `~/.config/opencode/antigravity-accounts.json`

### Google Cloud 设置

如需查询 Google Cloud (Antigravity) 账号额度，需要先安装 [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) 插件来完成 Google 账号认证。

## 安全性

本插件可以安全放心使用：

**读取的本地文件（只读）：**

- `~/.local/share/opencode/auth.json` - OpenCode 官方认证存储
- `~/.config/opencode/antigravity-accounts.json` - Antigravity 插件的账号存储

**请求的 API 接口（均为官方接口）：**

- `https://chatgpt.com/backend-api/wham/usage` - OpenAI 官方额度查询接口
- `https://bigmodel.cn/api/monitor/usage/quota/limit` - 智谱 AI 官方额度查询接口
- `https://api.z.ai/api/monitor/usage/quota/limit` - Z.ai 官方额度查询接口
- `https://api.synthetic.new/v2/quotas` - Synthetic 官方额度查询接口
- `https://api.github.com/copilot_internal/user` - GitHub Copilot 官方 API
- `https://oauth2.googleapis.com/token` - Google 官方 OAuth 接口
- `https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` - Google Cloud 官方接口

**隐私保护：**

- 插件不会保存、上传或缓存任何用户数据
- 敏感信息（API Key）在输出时自动脱敏显示
- 源代码完全开源，可随时审查

## Google Cloud 模型

插件显示以下模型的额度：

| 显示名称 | 模型 Key                                       |
| -------- | ---------------------------------------------- |
| G3 Pro   | `gemini-3-pro-high` / `gemini-3-pro-low`       |
| G3 Image | `gemini-3-pro-image`                           |
| G3 Flash | `gemini-3-flash`                               |
| Claude   | `claude-opus-4-5-thinking` / `claude-opus-4-5` |

## 开发

```bash
# 使用 npm
npm install
npm run typecheck
npm run build

# 或使用 Bun
bun install
bun run typecheck
bun run build
```

## 许可证

MIT
