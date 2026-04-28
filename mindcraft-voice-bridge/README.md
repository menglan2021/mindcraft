# Mindcraft Voice Bridge

这是一个给 Paper 服务端使用的 Simple Voice Chat 桥接插件。

## 功能

- 在 `127.0.0.1:8787` 启动本地 WebSocket 服务
- 接收 Mindcraft Node 进程发送的 `start/chunk/end/cancel/ping` 消息
- 把 48kHz、单声道、16-bit PCM 帧绑定到指定 bot 玩家实体位置播放
- 接收玩家的 Simple Voice Chat 语音，按一句话分段后回传给 Mindcraft 做 STT
- 同一 bot 的新播报会自动替换旧播报
- 提供 `/voicebridge` 状态查看和 `/voicebridge reload` 配置重载

## 构建

要求：

- JDK 21
- Maven 3.9+

构建命令：

```bash
cd /Users/menglan/Documents/frontProject/mindcraft
bash ./build-voicebridge.sh
```

产物位置：

```text
mindcraft-voice-bridge/target/mindcraft-voice-bridge-0.1.0.jar
```

如果你已经手动切到 `Java 21`，也可以直接执行：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
mvn -f mindcraft-voice-bridge/pom.xml clean package
```

## 本地启动

如果你已经在仓库根目录准备好了：

- `paper-1.21.6-48.jar`
- `voicechat-bukkit-2.5.32.jar`
- `server_data/paper-1.21.6-voicechat/`

可以直接在插件目录启动本地测试服：

```bash
bash ./mindcraft-voice-bridge/start-local-paper.sh
```

这个脚本会自动：

- 检查并切到 `Java 21`
- 在需要时重新构建 `mindcraft-voice-bridge`
- 把最新的 `mindcraft-voice-bridge-0.1.0.jar` 部署到本地测试服 `plugins/`
- 优先部署根目录的 `voicechat-bukkit-2.5.32.jar`
- 清理 Paper remap 缓存后启动本地 Paper

可选环境变量：

```bash
JAVA21_HOME=/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home \
PAPER_JAR=/path/to/paper.jar \
VOICECHAT_BUKKIT_JAR=/path/to/voicechat-bukkit.jar \
SERVER_DIR=/path/to/server \
bash ./mindcraft-voice-bridge/start-local-paper.sh
```

## 服务端安装

1. 在 Paper 服务端安装 `Simple Voice Chat` 插件。
2. 把构建出的 `mindcraft-voice-bridge-0.1.0.jar` 放进 `plugins/`。
3. 启动服务端一次，生成默认配置。
4. 根据需要修改 `plugins/MindcraftVoiceBridge/config.yml`。
5. 确保 Node 端和 Paper 在同一台机器，或把桥接监听地址改成允许访问的内网地址。

## 默认协议

```json
{"type":"start","utteranceId":"u_001","bot":"sanbai_bot","sampleRate":48000,"channels":1}
{"type":"chunk","utteranceId":"u_001","seq":1,"pcm16le_base64":"..."}
{"type":"end","utteranceId":"u_001"}
{"type":"cancel","utteranceId":"u_001"}
{"type":"ping","ts":1740000000000}
{"type":"register_bot","bot":"sanbai_bot","echoToChat":true,"endSilenceMs":900,"minDurationMs":700,"maxDurationMs":15000,"triggerCooldownMs":500}
{"type":"echo_chat","utteranceId":"in_001","speaker":"CharlieTalk","targetBot":"sanbai_bot","text":"来我这里砍树吧"}
```

## 已知约束

- 当前仅支持 `48kHz`、`单声道`、`16-bit PCM`、`20ms` 帧
- 当前按 bot 玩家名定位实体，因此 `bot_entity_name` 必须和在线玩家名一致
- 客户端需要安装 `Simple Voice Chat` 模组后才能听到声音
- 玩家语音上行默认会路由给“距离说话玩家最近、且已注册语音输入”的 bot
- `voice_input_echo_to_chat` 使用系统消息回显转写文本，不会再次触发 bot
- 当前默认语音转写模型为 `qwen/qwen3-asr-flash`，需要配置 `QWEN_API_KEY`
