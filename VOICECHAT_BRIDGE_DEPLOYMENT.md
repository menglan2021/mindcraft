# Mindcraft 在线服语音桥接部署说明

本文档对应当前仓库里的实现，而不是规划稿。

## 已实现内容

- Node 侧新增 `src/voice/` 模块，支持：
  - WebSocket 桥接协议封装
  - 24kHz PCM 到 48kHz PCM 重采样
  - 20ms 音频分帧
  - 语音队列、取消和桥接发送
  - 玩家语音上行桥接、STT 转写和 bot 消息注入
- `src/models/qwen.js` 新增流式 `streamAudioRequest()`，会按块产出 `response.audio.delta`
- `src/agent/speak.js` 新增三种输出模式：
  - `system`
  - `local_player`
  - `minecraft_voicechat`
- `mindcraft-voice-bridge/` 新增 Paper 插件骨架和桥接实现

## Node 侧配置

在 [settings.js](/Users/menglan/Documents/frontProject/mindcraft/settings.js) 中：

```javascript
"speak": true,
"voice_output_mode": "minecraft_voicechat",
"voice_bridge_host": "127.0.0.1",
"voice_bridge_port": 8787,
"voice_streaming": true,
"voice_target_sample_rate": 48000,
"voice_input_enabled": true,
"voice_input_echo_to_chat": true,
"voice_input_stt_model": "qwen/qwen3-asr-flash",
"voice_input_language": "zh",
"voice_input_end_silence_ms": 900,
"voice_input_min_duration_ms": 700,
"voice_input_max_duration_ms": 15000,
"voice_input_trigger_cooldown_ms": 500,
```

在 bot profile，例如 [sanbai_bot.json](/Users/menglan/Documents/frontProject/mindcraft/sanbai_bot.json) 中：

```json
"voice_bridge": {
  "enabled": true,
  "bot_entity_name": "sanbai_bot",
  "sample_rate": 48000,
  "channels": 1
}
```

## 服务端配置

1. 安装 Paper。
2. 安装 `Simple Voice Chat` 服务端插件。
3. 在仓库根目录执行 `bash ./build-voicebridge.sh` 构建 `mindcraft-voice-bridge` 插件，并把产物放入 `plugins/`。
4. 启动后确认 `plugins/MindcraftVoiceBridge/config.yml` 中的 `bridge.host` 和 `bridge.port` 与 Node 端一致。

默认配置：

```yaml
bridge:
  host: 127.0.0.1
  port: 8787

voice:
  sample_rate: 48000
  distance: 48.0
  whispering: false
  buffer_poll_timeout_ms: 40
```

## 联调顺序

1. 先确认 bot 能正常登录在线服。
2. 再确认客户端已安装 Simple Voice Chat 模组并能进入语音连接状态。
3. 启动 Paper 后执行 `/voicebridge`，确认插件状态正常。
4. 启动 Mindcraft，确认日志里出现 `[TTS] bridge connected`。
5. 让 bot 发送一条短中文，确认插件和 Node 两侧日志分别出现 `bridge start/chunk/end`。
6. 打开 `voice_input_enabled` 后，让带有 Simple Voice Chat 客户端模组的玩家说一句话，确认：
   - 插件日志出现 `forwarded voice input`
   - Mindcraft 日志出现 `[VoiceInput] transcript`
   - bot 把转写结果当成该玩家的消息继续处理

如果使用千问：

- 配置环境变量 `QWEN_API_KEY`
- `voice_input_stt_model` 使用 `qwen/qwen3-asr-flash`
- `voice_input_stt_url` 留空即可，默认会走 `DashScope compatible-mode`
- `voice_input_prompt` 可以保留，但当前 `qwen/qwen3-asr-flash` 兼容接口不会使用这个字段

## 常见问题

`BOT_NOT_FOUND`
说明插件找不到对应玩家实体。检查 `bot_entity_name` 是否和在线玩家名完全一致。

`VOICECHAT_NOT_AVAILABLE`
说明 Simple Voice Chat API 还没准备好，通常是服务端插件未加载成功。

`UNSUPPORTED_SAMPLE_RATE`
当前插件默认只接受 48000 Hz。检查 Node 端 `voice_target_sample_rate`。

`INVALID_AUDIO_FORMAT`
当前桥接链路只接受单声道 16-bit PCM 帧。若切换到其他 TTS 提供者，需要确认其返回格式可被转换。

`voice_input_echo_to_chat` 会不会再次触发 bot
不会。转写回显由插件作为系统消息显示到聊天栏，当前 bot 只监听玩家聊天和私聊，不会把这类系统消息再次当成用户输入处理。
