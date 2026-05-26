# 天翼云盘签到 Node.js 版

用于本地 NAS / Arcadia 等平台定时运行天翼云盘签到。脚本不依赖第三方 npm 包，Node.js 18 及以上即可运行。

## 环境变量

必填：

| 变量 | 说明 |
| --- | --- |
| `ty_username` | 天翼云盘账号，多个账号用 `&` 分隔 |
| `ty_password` | 天翼云盘密码，多个密码用 `&` 分隔 |

可选通知变量：

| 变量 | 说明 |
| --- | --- |
| `WXPUSHER_APP_TOKEN`、`WXPUSHER_UID` | WxPusher，多个 UID 用 `&` 分隔 |
| `PUSH_PLUS_TOKEN`、`PUSH_PLUS_USER` | PushPlus |
| `QYWX_KEY`、`QYWX_ORIGIN` | 企业微信机器人 |
| `DD_BOT_TOKEN`、`DD_BOT_SECRET` | 钉钉机器人 |
| `FS_KEY` 或 `FSKEY` | 飞书机器人 |
| `BARK_PUSH` 或 `BARK` | Bark |
| `CONSOLE` | 是否输出到控制台，默认 `true` |
| `ENABLE_LOTTERY` | 是否启用每日抽奖，默认不启用；填 `true` 开启 |

也可以在项目目录创建 `.env` 文件，本地运行时会自动读取：

```env
ty_username=13800000000
ty_password=your_password
WXPUSHER_APP_TOKEN=
WXPUSHER_UID=
```

## 运行

```bash
npm start
```

或直接：

```bash
node index.js
```

## Arcadia 部署

在 Arcadia 中创建 Node.js 脚本任务：

- 运行命令：`node index.js`
- 工作目录：本项目目录
- Node 版本：18 或更高
- 定时建议：每天 04:30 后运行一次
- 环境变量：按上表填写 `ty_username`、`ty_password` 和需要的通知变量

如果登录时提示验证码或风控，需要先在网页端手动登录并完成验证，等待风控解除后再运行脚本。
