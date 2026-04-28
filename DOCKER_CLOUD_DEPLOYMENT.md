# Mindcraft 云服务器 Docker 正式部署文档

本文档针对当前仓库里的语音桥接实现，目标是把以下整套链路部署到同一台云服务器上：

- `Paper 1.21.6 build 48`
- `Simple Voice Chat`
- `mindcraft-voice-bridge`
- `Mindcraft Node 22`

推荐拓扑：

- `minecraft` 容器：使用官方 `itzg/minecraft-server:java21`
- `mindcraft` 容器：使用本仓库里的 Node 22 镜像构建
- 两个容器在同一个 Docker 网络中通信
- `25565/TCP` 对外提供 Minecraft
- `24454/UDP` 对外提供 Simple Voice Chat
- `8787/TCP` 仅容器内网使用，不对公网开放
- `8080/TCP` 为 Mindcraft UI，默认只绑定到 `127.0.0.1`
- `MindServer` 在容器内会绑定到 `0.0.0.0`，这样同容器 agent 和 Docker 端口映射都能正常工作

## 1. 版本与前提

当前文档固定使用：

- Paper：`1.21.6`
- Paper build：`48`
- Minecraft 服务镜像：`itzg/minecraft-server:java21`
- Simple Voice Chat 插件：`voicechat-bukkit-2.5.32.jar`
- `mindcraft-voice-bridge`：当前仓库构建产物 `0.1.0`
- Mindcraft 运行时：`Node 22`

部署前请确保云服务器已经具备：

- Docker Engine
- Docker Compose v2
- JDK 21 和 Maven，用于在宿主机上构建 `mindcraft-voice-bridge`
- 可以开放防火墙端口
- 已经把本仓库上传或 `git clone` 到服务器

如果你的服务器还在使用旧版独立命令 `docker-compose`，本文档里所有 `docker compose` 命令都可以直接替换成 `docker-compose`。

Ubuntu 服务器建议先安装构建依赖：

```bash
sudo apt-get update
sudo apt-get install -y openjdk-21-jdk maven
```

如果你还要在宿主机直接运行 `npm install` 或 `bash ./start.sh`，需要使用 Node 22，并安装 `canvas` / `gl` 这类原生模块的编译依赖：

```bash
nvm install 22
nvm use 22
sudo apt-get install -y build-essential python3 pkg-config \
  libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libpixman-1-dev \
  libgl1-mesa-dev libgles2-mesa-dev libosmesa6-dev libxi-dev libxinerama-dev libxrandr-dev
```

只构建 `mindcraft-voice-bridge` 插件时不需要安装根项目的 Node 依赖。

本文档默认你仍然使用当前项目里的离线服接入方式：

- `settings.js` 中 `auth: "offline"`
- Paper 容器中 `ONLINE_MODE=FALSE`

如果你要改成正版在线模式，这不是简单改一个开关就结束，bot 侧认证链路也要一起改，本文档不覆盖那条路径。

## 2. 仓库里新增的部署文件

本文档配套以下文件：

- [deploy/cloud/docker-compose.yml](/Users/menglan/Documents/frontProject/mindcraft/deploy/cloud/docker-compose.yml)
- [deploy/cloud/mindcraft.Dockerfile](/Users/menglan/Documents/frontProject/mindcraft/deploy/cloud/mindcraft.Dockerfile)
- [deploy/cloud/.env.example](/Users/menglan/Documents/frontProject/mindcraft/deploy/cloud/.env.example)

## 3. 推荐目录结构

假设仓库放在：

```text
/opt/mindcraft
```

最终你会用到这些关键路径：

```text
/opt/mindcraft/
├── deploy/cloud/docker-compose.yml
├── deploy/cloud/.env
├── deploy/cloud/runtime/minecraft-data/
├── keys.json
├── settings.js
├── sanbai_bot.json
├── bots/
├── voicechat-bukkit-2.5.32.jar
└── mindcraft-voice-bridge/target/mindcraft-voice-bridge-0.1.0.jar
```

## 4. 先准备 Mindcraft 配置

### 4.1 准备 API Key

在仓库根目录：

```bash
cd /opt/mindcraft
cp keys.example.json keys.json
```

按你的实际模型提供商填写 `keys.json`。

如果你准备使用当前已经联调过的语音链路，至少要确保：

- `QWEN_API_KEY` 已填写

因为当前默认配置里：

- TTS 使用千问
- 玩家语音转文字默认使用 `qwen/qwen3-asr-flash`

### 4.2 检查 `settings.js`

推荐确认以下字段：

```javascript
"chat_ingame": true,
"speak": true,
"voice_output_mode": "minecraft_voicechat",
"voice_input_enabled": true,
"voice_input_echo_to_chat": true,
"voice_input_stt_model": "qwen/qwen3-asr-flash",
"voice_input_language": "zh",
"voice_input_end_silence_ms": 900,
"voice_input_min_duration_ms": 700,
"voice_input_max_duration_ms": 15000,
"voice_input_trigger_cooldown_ms": 500,
"show_command_syntax": "none",
"narrate_behavior": false,
```

说明：

- `chat_ingame: true` 会把 bot 文本回复同步到游戏聊天栏
- `voice_output_mode: "minecraft_voicechat"` 表示 bot 语音走 Paper 语音桥
- `show_command_syntax: "none"` 可避免把命令文本刷到聊天栏
- `narrate_behavior: false` 可避免自动行为播报刷屏

### 4.3 检查 `sanbai_bot.json`

至少确保包含：

```json
"voice_bridge": {
  "enabled": true,
  "bot_entity_name": "sanbai_bot",
  "sample_rate": 48000,
  "channels": 1
}
```

其中 `bot_entity_name` 必须和 bot 实际登录到服务器后的玩家名完全一致。

## 5. 构建 `mindcraft-voice-bridge` 插件

在仓库根目录执行：

```bash
cd /opt/mindcraft
bash ./build-voicebridge.sh -DskipTests
```

产物位置：

```text
mindcraft-voice-bridge/target/mindcraft-voice-bridge-0.1.0.jar
```

## 6. 准备部署目录与插件

### 6.1 创建部署环境文件

```bash
cd /opt/mindcraft
cp deploy/cloud/.env.example deploy/cloud/.env
```

然后编辑：

```bash
vim deploy/cloud/.env
```

至少改这些值：

- `OPS=你的游戏管理员ID`
- `RCON_PASSWORD=强密码`
- 如果你要给 Minecraft 更多或更少内存，调整 `MC_MEMORY`
- 如果你要开放 UI 给反代或隧道使用，再调整 `MINDSERVER_BIND`

### 6.2 创建 Minecraft 数据目录

```bash
mkdir -p deploy/cloud/runtime/minecraft-data/plugins
```

### 6.3 复制插件 JAR

```bash
cp voicechat-bukkit-2.5.32.jar deploy/cloud/runtime/minecraft-data/plugins/
cp mindcraft-voice-bridge/target/mindcraft-voice-bridge-0.1.0.jar deploy/cloud/runtime/minecraft-data/plugins/
```

这一步完成后，Paper 容器第一次启动时就会直接加载这两个插件。

另外，当前 `deploy/cloud/docker-compose.yml` 已经默认给 `mindcraft` 容器设置：

```yaml
MINDSERVER_HOST_PUBLIC: "true"
```

不要删掉这项。Docker 场景下需要它把容器内的 MindServer 绑定到 `0.0.0.0`，否则可能出现：

- `MindServer running on port 8080 on host localhost`
- agent 随后连接 `127.0.0.1:8080`
- 最终报 `xhr poll error` / `ECONNREFUSED`

## 7. 首次启动 Paper，生成配置文件

第一次不要直接全量启动，先只起 Minecraft 容器：

```bash
cd /opt/mindcraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml up -d minecraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml logs -f minecraft
```

第一次启动需要关注两件事：

- 容器是否正确下载并启动 `Paper 1.21.6 build 48`
- 两个插件是否正常加载

当日志里看到服务端已经启动完成后，先停掉：

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml stop minecraft
```

## 8. 修改服务端插件配置

### 8.1 修改 `MindcraftVoiceBridge` 配置

编辑文件：

[deploy/cloud/runtime/minecraft-data/plugins/MindcraftVoiceBridge/config.yml](/Users/menglan/Documents/frontProject/mindcraft/deploy/cloud/runtime/minecraft-data/plugins/MindcraftVoiceBridge/config.yml)

改成：

```yaml
bridge:
  host: 0.0.0.0
  port: 8787

voice:
  sample_rate: 48000
  distance: 48.0
  whispering: false
  buffer_poll_timeout_ms: 40
```

这里最关键的是：

- `host: 0.0.0.0`

原因：

- 插件默认只监听 `127.0.0.1`
- 现在 Mindcraft 是另一个容器
- 如果不改成 `0.0.0.0`，`mindcraft` 容器无法连到 `minecraft:8787`

### 8.2 修改 Simple Voice Chat 配置

编辑文件：

[deploy/cloud/runtime/minecraft-data/plugins/voicechat/voicechat-server.properties](/Users/menglan/Documents/frontProject/mindcraft/deploy/cloud/runtime/minecraft-data/plugins/voicechat/voicechat-server.properties)

建议至少确认这些项：

```properties
port=24454
bind_address=
max_voice_distance=48
whisper_distance=24
```

说明：

- `port=24454` 是默认且推荐的独立语音 UDP 端口
- `bind_address=` 建议先留空，按 Simple Voice Chat 官方建议使用默认绑定逻辑
- 不要把语音端口和 Minecraft 游戏端口混用

改完后重新启动 `minecraft` 容器即可生效。

## 9. 防火墙与安全组

云服务器至少要放行：

- `25565/TCP`：Minecraft 游戏连接
- `24454/UDP`：Simple Voice Chat 语音连接

建议只在服务器本机开放或反向代理后再访问：

- `8080/TCP`：Mindcraft UI

不要对公网开放：

- `8787/TCP`

这是 Mindcraft 和 Paper 语音桥插件之间的内部 WebSocket 端口，只需要容器内网互通。

## 10. 启动整套服务

### 10.1 先启动 Minecraft

```bash
cd /opt/mindcraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml up -d minecraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml logs -f minecraft
```

等到日志里明确看到服务端启动完成，再启动 Mindcraft：

### 10.2 再启动 Mindcraft

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml up -d --build mindcraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml logs -f mindcraft
```

如果这是第一次切到新版本部署，或者你刚更新了 `main.js` / `src/mindcraft/*`，务必带 `--build`，否则容器里可能还是旧镜像。

不建议第一次就直接 `up -d` 全部服务，因为那样很难区分问题到底出在：

- Paper 未启动完成
- 插件没加载
- Mindcraft 连服失败
- 语音桥未连通

## 11. 上线后的验证顺序

按这个顺序查，定位最快：

### 11.1 验证 Paper 服

- 玩家能正常进入服务器
- 游戏聊天正常
- `/plugins` 能看到 `voicechat` 和 `MindcraftVoiceBridge`
- 执行 `/voicebridge` 可以看到插件状态

### 11.2 验证 bot 进服

在 `mindcraft` 日志里确认：

- bot 成功连接到 `minecraft:25565`
- bot 已经出生
- 没有持续重连或认证报错

### 11.3 验证语音下行：bot 说话

目标结果：

- bot 在聊天栏发文字
- 同时游戏里能听到 bot 语音

如果下行成功，通常会看到：

- `mindcraft` 日志出现桥接连接成功或 TTS 发送日志
- `minecraft` 日志出现 `websocket connected`
- 后续出现 `session started`、`audio player started`

### 11.4 验证语音上行：玩家说话

目标结果：

- 玩家通过 Simple Voice Chat 说一句中文
- 聊天栏出现 `【语音转写】...`
- bot 把转写内容当成玩家消息继续回复

如果上行成功，通常会看到：

- `minecraft` 日志出现 `forwarded voice input`
- `mindcraft` 日志出现 `[VoiceInput] transcript`

## 12. 客户端要求

每个玩家客户端都需要：

- 安装与当前客户端版本匹配的 `Simple Voice Chat` 模组
- 第一次进服后按 `V` 完成语音向导
- 能正常连接到服务端的语音 UDP 端口

如果游戏里右下角语音图标一直异常，优先检查的不是 bot，而是：

- `24454/UDP` 有没有开放
- 客户端模组版本是否匹配
- 服务端 `voicechat-server.properties` 是否被错误改过

## 13. 常用运维命令

启动：

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml up -d minecraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml up -d --build mindcraft
```

停止：

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml stop mindcraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml stop minecraft
```

重启：

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml restart minecraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml restart mindcraft
```

看日志：

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml logs -f minecraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml logs -f mindcraft
```

进入 Minecraft 容器控制台：

```bash
docker attach mindcraft-minecraft
```

退出 attach 且不停止容器：

```text
Ctrl-P Ctrl-Q
```

## 14. 升级与变更

### 14.1 升级 `mindcraft-voice-bridge`

```bash
cd /opt/mindcraft
bash ./build-voicebridge.sh -DskipTests
cp mindcraft-voice-bridge/target/mindcraft-voice-bridge-0.1.0.jar deploy/cloud/runtime/minecraft-data/plugins/
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml restart minecraft
```

### 14.2 升级 Mindcraft Node 服务

```bash
cd /opt/mindcraft
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml up -d --build mindcraft
```

### 14.3 升级 Paper 小版本

修改 [deploy/cloud/docker-compose.yml](/Users/menglan/Documents/frontProject/mindcraft/deploy/cloud/docker-compose.yml) 里的：

- `VERSION`
- `PAPER_BUILD`

然后重建容器：

```bash
docker compose --env-file deploy/cloud/.env -f deploy/cloud/docker-compose.yml up -d minecraft
```

注意同时检查：

- `voicechat-bukkit` 版本兼容性
- `mindcraft-voice-bridge` 是否仍适配目标 Paper API

## 15. 常见故障排查

### 15.1 玩家能进服，但语音图标不亮

优先检查：

- `24454/UDP` 是否开放
- `docker-compose.yml` 是否真的写成了 `24454:24454/udp`
- 客户端是否安装了 Simple Voice Chat 模组

### 15.2 bot 能发文字，但游戏里听不到 bot 语音

优先检查：

- `MindcraftVoiceBridge/config.yml` 是否还是 `host: 127.0.0.1`
- `mindcraft` 容器里 `VOICE_BRIDGE_HOST` 是否为 `minecraft`
- `mindcraft` 日志里是否有桥接连接失败

### 15.3 玩家说话后，bot 没反应

优先检查：

- `voice_input_enabled` 是否为 `true`
- `QWEN_API_KEY` 是否有效
- `minecraft` 日志里有没有 `forwarded voice input`
- `mindcraft` 日志里有没有 `[VoiceInput] transcript`

### 15.4 bot 无法登录服务器

当前文档默认是离线服方案。如果你把服务器改成了：

- `ONLINE_MODE=TRUE`

那现在这套 `auth: "offline"` 配置会直接失效。

### 15.5 聊天栏刷很多内部动作或命令文本

检查 [settings.js](/Users/menglan/Documents/frontProject/mindcraft/settings.js)：

- `show_command_syntax` 保持为 `none`
- `narrate_behavior` 保持为 `false`

### 15.6 `mindcraft` 容器启动时报 `xhr poll error`

如果日志类似：

- `MindServer running on port 8080 on host localhost`
- `Connecting to MindServer`
- `connect ECONNREFUSED 127.0.0.1:8080`

优先检查：

- `deploy/cloud/docker-compose.yml` 里是否存在 `MINDSERVER_HOST_PUBLIC: "true"`
- 是否执行了 `docker compose ... up -d --build mindcraft`
- 旧容器是否还在跑旧镜像，可先 `docker compose ... rm -sf mindcraft` 再重新 `up -d --build`

## 16. 官方参考

以下内容我已经按当前日期核对过，部署时建议也以这些官方文档为准：

- `itzg/minecraft-server` Paper 说明：
  https://docker-minecraft-server.readthedocs.io/en/latest/types-and-platforms/server-types/paper/
- `itzg/minecraft-server` Java 镜像标签说明：
  https://docker-minecraft-server.readthedocs.io/en/latest/versions/java/
- Simple Voice Chat 服务端配置：
  https://dev.modrepo.de/minecraft/voicechat/wiki/server_config
- Simple Voice Chat 自建服与 Docker 端口说明：
  https://modrepo.de/minecraft/voicechat/wiki/server_setup_self_hosted
