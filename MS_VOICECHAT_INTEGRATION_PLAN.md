# Mindcraft 在线服语音集成实施方案

## 1. 方案范围

本文档对应的目标是：

- 保留本项目作为独立 Node 服务运行
- 让 Mindcraft bot 连接在线 Minecraft 服务端
- 让玩家在游戏内直接听到 bot 的语音
- 不依赖浏览器页面播放音频
- 优先兼容 Windows 部署，同时保留 Linux 服务端可行性

本文档不覆盖以下内容：

- 将整个项目改造成 MS 安装包内置模块
- 不安装任何客户端语音模组时的原版客户端语音下发
- 前端网页播放器方案

## 2. 推荐技术路线

推荐采用：

- Minecraft 在线服：Paper
- 服务端语音能力：Simple Voice Chat
- 客户端语音能力：Simple Voice Chat Mod
- Mindcraft 语音生成：Qwen Realtime TTS
- Mindcraft 到服务端插件的桥接：本机 WebSocket

原因：

- 本项目当前是独立 Node 进程架构，接入服务端插件比重构为宿主内嵌模块更快
- Simple Voice Chat 已提供服务端音频通道能力，适合把 bot 语音绑定到实体位置
- WebSocket 更适合做持续的音频帧传输与长连接控制

## 3. 总体架构

```text
Qwen Realtime TTS
        |
        | WebSocket
        v
Mindcraft(Node)
  - 聊天/推理
  - Mineflayer bot
  - TTS 音频流接收
  - 24k PCM -> 48k PCM 重采样
  - 20ms 音频帧切片
        |
        | 本机 WebSocket
        v
Mindcraft Voice Bridge(Paper 插件)
  - bot 玩家实体定位
  - EntityAudioChannel 创建
  - AudioPlayer 推流
  - 会话管理/重连/日志
        |
        | Simple Voice Chat 语音通道
        v
玩家客户端(Simple Voice Chat Mod)
```

## 4. 开发任务清单

### 阶段 1：服务端语音通道验证

- [ ] 搭建一套可联调环境：Paper 服务端 + Simple Voice Chat + 一个装了客户端模组的测试客户端
- [ ] 编写最小可运行 Paper 插件骨架 `mindcraft-voice-bridge`
- [ ] 插件启动后注册本机 WebSocket 服务，默认监听 `127.0.0.1:8787`
- [ ] 插件实现固定 WAV/PCM 文件播放，不接 Mindcraft，先验证客户端能在游戏内听到声音
- [ ] 验证声音是否能绑定到指定玩家实体位置，而不是全局广播
- [ ] 验证玩家远近变化时的空间音量效果是否符合预期

阶段验收：

- [ ] 玩家靠近 bot 时能听到服务端下发音频
- [ ] 玩家离开 bot 后音量正常衰减
- [ ] 不装语音模组的玩家不报错，功能自然缺失

### 阶段 2：插件桥接协议实现

- [ ] 定义 Node 与插件之间的消息协议
- [ ] 实现 `start/chunk/end/cancel/ping` 五类消息
- [ ] 为每个播报会话分配唯一 `utteranceId`
- [ ] 插件端实现 bot 名称到在线玩家实体的映射
- [ ] 插件端实现每个 `utteranceId` 的缓冲区和播放状态机
- [ ] 插件端实现连接断开、会话取消、bot 不在线等异常处理

建议协议：

```json
{"type":"start","utteranceId":"u_001","bot":"sanbai_bot","sampleRate":48000,"channels":1}
{"type":"chunk","utteranceId":"u_001","seq":1,"pcm16le_base64":"..."}
{"type":"end","utteranceId":"u_001"}
{"type":"cancel","utteranceId":"u_001"}
{"type":"ping","ts":1740000000000}
```

阶段验收：

- [ ] 插件可以稳定接收长连接音频数据
- [ ] 插件在 bot 不在线时拒绝播放并返回明确日志
- [ ] 多句播报不会串音或错位

### 阶段 3：Mindcraft 实时音频输出改造

- [ ] 将当前“先收完整段再返回”的 TTS 接口改为“可流式产出音频帧”
- [ ] 为 Qwen realtime 模型新增流式接口，逐块输出 `response.audio.delta`
- [ ] 新增统一语音输出层，支持本地播放和 Minecraft 语音桥接两种模式
- [ ] 在语音桥接模式下，直接把音频帧送给插件，不再落盘、不再调用 `ffplay/afplay`
- [ ] 增加音频队列控制，避免短时间内多句重叠

阶段验收：

- [ ] bot 一发言，插件侧能在 300ms 到 1000ms 内开始收到音频帧
- [ ] 单句语音不会等整段生成完才开始播放
- [ ] 取消当前发言时，后续帧不会继续下发

### 阶段 4：音频格式处理

- [ ] 确认 Qwen Realtime 返回的 PCM 格式和采样率
- [ ] 新增 24kHz 单声道 PCM 到 48kHz 单声道 PCM 的重采样模块
- [ ] 将连续 PCM 流切成 20ms 一帧
- [ ] 每帧按 `960 samples` 打包
- [ ] 验证大段中文连续播报时无明显爆音、加速、拖尾

阶段验收：

- [ ] 语音音高正常
- [ ] 语速正常
- [ ] 连续句子之间无明显杂音

### 阶段 5：配置与运维

- [ ] 在 `settings.js` 中增加语音输出目标配置
- [ ] 在 bot profile 中增加 `voice_bridge` 配置
- [ ] 增加 Mindcraft 侧日志：连接成功、开始播报、结束播报、取消播报、失败原因
- [ ] 增加插件侧日志：接收连接、创建通道、实体不存在、缓冲耗尽、会话结束
- [ ] 编写部署文档：服务端安装、客户端要求、端口说明、常见问题

阶段验收：

- [ ] 新机器按文档可以完成部署
- [ ] 不需要改代码即可切换 bot 名称、桥接地址、是否启用语音桥接

## 5. 插件目录结构

建议使用 Gradle 的 Paper 插件工程，目录如下：

```text
mindcraft-voice-bridge/
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/
│   │   │       └── mindcraft/
│   │   │           └── voicebridge/
│   │   │               ├── MindcraftVoiceBridgePlugin.java
│   │   │               ├── config/
│   │   │               │   └── PluginConfig.java
│   │   │               ├── websocket/
│   │   │               │   ├── BridgeWebSocketServer.java
│   │   │               │   ├── BridgeSession.java
│   │   │               │   └── MessageCodec.java
│   │   │               ├── voice/
│   │   │               │   ├── VoiceChannelManager.java
│   │   │               │   ├── AudioFrameBuffer.java
│   │   │               │   ├── BotAudioSession.java
│   │   │               │   └── BotEntityLocator.java
│   │   │               ├── model/
│   │   │               │   ├── StartMessage.java
│   │   │               │   ├── ChunkMessage.java
│   │   │               │   ├── EndMessage.java
│   │   │               │   ├── CancelMessage.java
│   │   │               │   └── PingMessage.java
│   │   │               ├── command/
│   │   │               │   └── VoiceBridgeDebugCommand.java
│   │   │               └── util/
│   │   │                   ├── Base64Audio.java
│   │   │                   ├── TickScheduler.java
│   │   │                   └── Loggers.java
│   │   └── resources/
│   │       ├── plugin.yml
│   │       └── config.yml
└── README.md
```

### 各目录职责

- `websocket/`：接收 Node 发来的音频控制消息
- `voice/`：对接 Simple Voice Chat API，管理音频通道和播放状态
- `model/`：定义桥接协议消息结构
- `config/`：插件配置加载
- `command/`：调试命令，例如手动播放测试音
- `util/`：日志、调度、base64 解码等通用工具

## 6. 本项目改动清单

### 6.1 新增文件

建议新增以下文件：

```text
src/voice/
├── bridge_client.js
├── bridge_protocol.js
├── pcm_resampler.js
├── stream_queue.js
└── audio_frame.js
```

建议职责如下：

- `bridge_client.js`：维护到插件的 WebSocket 长连接，负责发送 `start/chunk/end/cancel`
- `bridge_protocol.js`：封装消息格式和序列号生成
- `pcm_resampler.js`：完成 24kHz 到 48kHz 的 PCM 重采样
- `stream_queue.js`：控制多句播报排队、取消和状态切换
- `audio_frame.js`：负责把 PCM 缓冲切成固定帧

### 6.2 修改文件

#### [src/models/qwen.js](/Users/menglan/Documents/frontProject/mindcraft/src/models/qwen.js)

需要改造点：

- 保留当前 `sendAudioRequest()` 兼容旧逻辑
- 新增 `streamAudioRequest(text, model, voice, url, params)` 方法
- 对 realtime 模型使用异步流接口，而不是等 `session.finished` 后一次性返回
- 收到 `response.audio.delta` 后立即 `yield` PCM 数据块
- 增加 `abort` 支持，便于中途取消语音

建议新增导出：

```javascript
export const TTSConfig = {
    sendAudioRequest,
    streamAudioRequest,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
}
```

#### [src/agent/speak.js](/Users/menglan/Documents/frontProject/mindcraft/src/agent/speak.js)

需要改造点：

- 把当前 `fetchRemoteAudio()` 逻辑拆成两类：
  - 非流式：返回完整音频
  - 流式：返回音频块迭代器
- 新增输出模式判断：
  - `system`
  - `local_player`
  - `minecraft_voicechat`
- 当输出模式为 `minecraft_voicechat` 时：
  - 不再写临时文件
  - 不再调用 `ffplay/afplay`
  - 改为调用 `bridge_client.js`
- 保留原有本地播放模式作为回退方案
- 增加清晰日志：
  - `[TTS] bridge connected`
  - `[TTS] bridge start`
  - `[TTS] bridge chunk`
  - `[TTS] bridge end`
  - `[TTS] bridge cancel`

#### [settings.js](/Users/menglan/Documents/frontProject/mindcraft/settings.js)

建议新增配置：

```javascript
"voice_output_mode": "minecraft_voicechat",
"voice_bridge_host": "127.0.0.1",
"voice_bridge_port": 8787,
"voice_streaming": true,
"voice_target_sample_rate": 48000,
```

说明：

- `voice_output_mode`：控制语音输出去向
- `voice_bridge_host` / `voice_bridge_port`：插件桥接地址
- `voice_streaming`：是否启用流式播报
- `voice_target_sample_rate`：插件接收的目标采样率

#### [sanbai_bot.json](/Users/menglan/Documents/frontProject/mindcraft/sanbai_bot.json)

建议补充：

```json
"voice_bridge": {
  "enabled": true,
  "bot_entity_name": "sanbai_bot",
  "sample_rate": 48000,
  "channels": 1
}
```

说明：

- `bot_entity_name` 必须和在线服里 bot 的实际玩家名一致
- `sample_rate` 与插件播放要求保持一致

### 6.3 可选修改

#### [src/agent/agent.js](/Users/menglan/Documents/frontProject/mindcraft/src/agent/agent.js)

可选增强：

- 在发言前生成 `utteranceId`
- 当 bot 被打断、切换任务或重启时主动取消当前语音
- 将聊天消息和语音会话日志关联起来，便于排查“文本发了但没声音”的问题

#### [start.sh](/Users/menglan/Documents/frontProject/mindcraft/start.sh)

可选增强：

- 支持同时启动 Mindcraft 和本地语音桥接代理
- 增加启动前端口检查
- 增加 `VOICE_BRIDGE_HOST`、`VOICE_BRIDGE_PORT` 环境变量透传

## 7. Node 与插件接口约定

### WebSocket 地址

- 默认：`ws://127.0.0.1:8787`
- 仅监听本机，避免未授权写入音频流

### 会话规则

- 每句播报一个 `utteranceId`
- 同一 bot 同时只允许一个活动播报
- 新播报开始时，旧播报自动取消
- 插件端收到 `end` 后等待缓冲区播放完成再清理会话

### 错误码建议

- `BOT_NOT_FOUND`
- `VOICECHAT_NOT_AVAILABLE`
- `INVALID_AUDIO_FORMAT`
- `SESSION_NOT_FOUND`
- `SESSION_ALREADY_EXISTS`
- `UNSUPPORTED_SAMPLE_RATE`

## 8. 开发优先级建议

建议按下面顺序推进：

1. 先做插件固定音频播放
2. 再做 Node 到插件的 WebSocket 桥接
3. 再做 Qwen realtime 真流式输出
4. 最后做重采样、取消、异常恢复和部署文档

原因：

- 先验证“客户端能不能在游戏里听到”这个核心链路
- 再接入动态实时音频，能显著降低排障成本

## 9. 联调检查项

- [ ] bot 可以正常登录在线服
- [ ] 服务端插件能定位到 bot 对应实体
- [ ] 插件已成功挂接 Simple Voice Chat
- [ ] Mindcraft 已成功连接本机 WebSocket
- [ ] 收到文本发言后 1 秒内开始播报
- [ ] 玩家靠近 bot 能听到声音
- [ ] 玩家远离 bot 音量衰减正常
- [ ] bot 被打断时当前语音会立即停止
- [ ] 服务端重启后桥接能自动恢复

## 10. 主要风险

- 原版客户端不安装语音模组时，无法直接接收这类自定义语音
- 不同平台的音频时间片和缓冲策略不同，需实测调优
- 在线服如果 bot 名称与实体名不一致，插件定位会失败
- 如果 Qwen realtime 返回音频格式变化，重采样逻辑需同步调整
- Windows 部署时如果桥接层或音频依赖处理不当，容易出现延迟抖动

## 11. 交付物清单

第一阶段建议交付以下内容：

- `mindcraft-voice-bridge` 插件源码
- 本项目语音桥接改造代码
- 一份部署文档
- 一份联调说明
- 一份常见故障排查说明

如果按最小闭环交付，目标是：

- bot 在在线服中说话
- 玩家在游戏内听到 bot 的实时语音
- 服务端和 Node 端都能看到明确日志
