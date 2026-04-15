const settings = {
    "minecraft_version": "auto", // 或填写具体版本，例如 "1.21.6"
    "host": "127.0.0.1", // 或填写 "localhost"、"your.ip.address.here"
    "port": 25565, // 默认按 README 连接本地局域网世界；设为 -1 时会自动扫描可用端口
    "auth": "offline", // 离线服保持使用 "offline"

    // mindserver 负责管理所有 agent，并托管 UI
    "mindserver_port": 8080,
    "mindserver_host_public": false, // 是否把 MindServer 绑定到 0.0.0.0；Docker/反代场景需要开启，本机单机运行建议保持 false
    "auto_open_ui": true, // 启动时自动在浏览器中打开 UI

    "base_profile": "assistant", // 可选：survival、assistant、creative、god_mode
    "profiles": [
        "./sanbai_bot.json",
        // "./profiles/gpt.json",
        // "./profiles/claude.json",
        // "./profiles/gemini.json",
        // "./profiles/llama.json",
        // "./profiles/qwen.json",
        // "./profiles/grok.json",
        // "./profiles/mistral.json",
        // "./profiles/deepseek.json",
        // "./profiles/mercury.json",
        // "./profiles/andy-4.json", // 最多支持 75 条消息上下文

        // 使用多个 profile 时，需要通过 /msg 分别和每个 bot 交互
        // 单个 profile 中的字段会覆盖 base_profile 中的同名配置
    ],

    "load_memory": false, // 是否加载上一次会话的记忆
    "init_message": "Respond with hello world and your name", // bot 出生后发送给所有 bot 的初始化消息
    "only_chat_with": [], // 仅监听并回应这些用户；为空时会在公共聊天中交流

    "speak": true,
    // 是否启用 bot 的文字转语音输出。关闭时只发文字，不会发任何语音。
    // 具体使用哪个 TTS 模型，由各自 profile 里的 speak_model 决定。
    // voice_output_mode 决定“生成出来的语音要输出到哪里”：
    // - system：直接调用当前操作系统自带朗读能力。
    //   适合快速本机试听，不依赖远程 TTS 音频播放器。
    //   Windows / macOS 可直接用；Linux 一般需要先安装 espeak。
    // - local_player：先生成 TTS 音频，再在运行 Mindcraft 的这台机器本地播放。
    //   只有本机能听到，游戏内玩家听不到。
    // - minecraft_voicechat：把 TTS 音频通过 WebSocket 发给 Paper 端的语音桥接插件，
    //   再由 Simple Voice Chat 在游戏里播放。适合“bot 在游戏里开口说话”的场景。
    //   这个模式需要同时满足：
    //   1. 服务端是 Paper
    //   2. 已安装 Simple Voice Chat 服务端插件
    //   3. 已安装 mindcraft-voice-bridge 插件
    //   4. 客户端装了 Simple Voice Chat 模组并成功连上语音
    "voice_output_mode": "local_player", // 通用默认值；如果要走 Paper 游戏内语音，请改成 minecraft_voicechat 或使用本地测试脚本覆盖
    "voice_bridge_host": "127.0.0.1", // 仅在 minecraft_voicechat 模式下使用；Paper 语音桥接插件监听地址
    "voice_bridge_port": 8787, // 仅在 minecraft_voicechat 模式下使用；Paper 语音桥接插件监听端口
    "voice_streaming": true, // 仅在 minecraft_voicechat 模式下使用；是否优先按流式分片把音频推给桥接插件
    "voice_target_sample_rate": 48000, // 仅在 minecraft_voicechat 模式下使用；桥接目标采样率，当前建议固定为 48000
    // 是否启用“玩家语音 -> STT -> bot 消息”的上行链路。
    // 开启后，Paper 侧 mindcraft-voice-bridge 会接收玩家的 Simple Voice Chat 语音，
    // 按一句话切段后发给 Mindcraft，再由 STT 转写成文字并作为该玩家的消息送给 bot。
    "voice_input_enabled": false,
    // 是否把 STT 转写结果再同步显示到游戏聊天栏。
    // 这里会作为系统消息显示，目的是让玩家看到转写内容，但不要再次触发 bot。
    "voice_input_echo_to_chat": false,
    // 语音转写模型。默认使用千问兼容接口的 qwen3-asr-flash。
    // 也可以写成 openai/gpt-4o-transcribe、qwen/其他模型，或在 profile.voice_input.stt_model 中单独覆盖。
    // 使用 qwen/* 时需要提前配置环境变量 QWEN_API_KEY。
    "voice_input_stt_model": "qwen/qwen3-asr-flash",
    // 语音转写接口地址。留空时使用对应 provider 的默认地址。
    // 如果你使用 OpenAI-compatible 网关，可以在这里填写自定义 base URL。
    "voice_input_stt_url": "",
    // 语音转写的目标语言。默认按中文转写，不做翻译。
    "voice_input_language": "zh",
    // 给 STT 的附加提示，帮助模型更稳定地按原文转写。
    // 当前 OpenAI 转写接口会使用这个字段；qwen/qwen3-asr-flash 兼容接口下该字段会被忽略。
    "voice_input_prompt": "请直接转写玩家语音内容，不要翻译，不要添加说话人标签，不要补充解释。",
    // 判定一句话结束前，至少需要持续多久没有新的语音包进入，避免“话还没说完就触发”。
    "voice_input_end_silence_ms": 900,
    // 小于这个时长的语音片段会被丢弃，减少咳嗽声、误触发和零碎短音。
    "voice_input_min_duration_ms": 700,
    // 单次语音片段的最大时长，超过会强制截断并触发转写，避免无限积累。
    "voice_input_max_duration_ms": 15000,
    // 一次转写刚触发后，短时间内不再立即开启下一次，减少连续抖动触发。
    "voice_input_trigger_cooldown_ms": 500,

    "chat_ingame": true, // 是否把 bot 的回复显示在 Minecraft 聊天中
    "language": "en", // 自动翻译所使用的目标语言；支持的语言名称见 https://cloud.google.com/translate/docs/languages
    "render_bot_view": false, // 是否在浏览器中展示 bot 视角，端口一般为 localhost:3000、3001 等

    "allow_insecure_coding": true, // 是否允许 `newAction`，开启后模型可在你的电脑上写代码和执行代码，请自行承担风险
    "allow_vision": false, // 是否允许视觉模型将截图作为输入进行理解
    "blocked_actions" : ["!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel"] , // 要禁用并从文档中移除的命令，例如 ["!setMode"]
    "code_timeout_mins": -1, // 代码允许执行的分钟数；-1 表示不限制
    "relevant_docs_count": 5, // 提示词中选取多少条相关代码函数文档；-1 表示全部加入

    "max_messages": 15, // 上下文中最多保留多少条消息
    "num_examples": 2, // 提供给模型的示例数量
    "max_commands": -1, // 单次连续回复中最多可使用多少个命令；-1 表示不限制
    "show_command_syntax": "none", // 可选："full"、"shortened"、"none"
    "narrate_behavior": false, // 是否把简单自动行为发到聊天中，例如“Picking up item!”
    "chat_bot_messages": true, // 是否公开显示 bot 之间的聊天消息

    "spawn_timeout": 30, // bot 出生允许等待的秒数，超时会报错；如果出生较慢可适当调大
    "block_place_delay": 0, // 使用 `newAction` 放置方块时的延迟（毫秒），可降低被反作弊踢出的概率

    "log_all_prompts": false, // 是否把所有提示词完整写入日志文件

}

export default settings;
