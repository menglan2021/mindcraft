const settings = {
    "minecraft_version": "auto", // 或填写具体版本，例如 "1.21.6"
    "host": "127.0.0.1", // 或填写 "localhost"、"your.ip.address.here"
    "port": 55916, // 设为 -1 时会自动扫描可用端口
    "auth": "offline", // 离线服保持使用 "offline"

    // mindserver 负责管理所有 agent，并托管 UI
    "mindserver_port": 8080,
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

    "load_memory": true, // 是否加载上一次会话的记忆
    "init_message": "Respond with hello world and your name", // bot 出生后发送给所有 bot 的初始化消息
    "only_chat_with": [], // 仅监听并回应这些用户；为空时会在公共聊天中交流

    "speak": false,
    // 是否允许所有 bot 使用文字转语音朗读
    // 在各自 profile 中通过 {provider}/{model}/{voice} 的格式指定语音模型
    // 如果设为 "system"，则使用系统自带的基础语音功能
    // Windows 和 macOS 可直接使用；Linux 需要先安装 espeak，例如 `apt install espeak` 或 `pacman -S espeak`

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
    "show_command_syntax": "full", // 可选："full"、"shortened"、"none"
    "narrate_behavior": true, // 是否把简单自动行为发到聊天中，例如“Picking up item!”
    "chat_bot_messages": true, // 是否公开显示 bot 之间的聊天消息

    "spawn_timeout": 30, // bot 出生允许等待的秒数，超时会报错；如果出生较慢可适当调大
    "block_place_delay": 0, // 使用 `newAction` 放置方块时的延迟（毫秒），可降低被反作弊踢出的概率

    "log_all_prompts": false, // 是否把所有提示词完整写入日志文件

}

export default settings;
