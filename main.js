import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';

function parseArguments() {
    return yargs(hideBin(process.argv))
        .option('profiles', {
            type: 'array',
            describe: 'List of agent profile paths',
        })
        .option('task_path', {
            type: 'string',
            describe: 'Path to task file to execute'
        })
        .option('task_id', {
            type: 'string',
            describe: 'Task ID to execute'
        })
        .help()
        .alias('help', 'h')
        .parse();
}
const args = parseArguments();
if (args.profiles) {
    settings.profiles = args.profiles;
}
if (args.task_path) {
    let tasks = JSON.parse(readFileSync(args.task_path, 'utf8'));
    if (args.task_id) {
        settings.task = tasks[args.task_id];
        settings.task.task_id = args.task_id;
    }
    else {
        throw new Error('task_id is required when task_path is provided');
    }
}

// these environment variables override certain settings
if (process.env.MINECRAFT_PORT) {
    settings.port = process.env.MINECRAFT_PORT;
}
if (process.env.MINDSERVER_PORT) {
    settings.mindserver_port = process.env.MINDSERVER_PORT;
}
if (process.env.PROFILES && JSON.parse(process.env.PROFILES).length > 0) {
    settings.profiles = JSON.parse(process.env.PROFILES);
}
if (process.env.INSECURE_CODING) {
    settings.allow_insecure_coding = true;
}
if (process.env.BLOCKED_ACTIONS) {
    settings.blocked_actions = JSON.parse(process.env.BLOCKED_ACTIONS);
}
if (process.env.MAX_MESSAGES) {
    settings.max_messages = process.env.MAX_MESSAGES;
}
if (process.env.NUM_EXAMPLES) {
    settings.num_examples = process.env.NUM_EXAMPLES;
}
if (process.env.LOG_ALL) {
    settings.log_all_prompts = process.env.LOG_ALL;
}
if (process.env.VOICE_OUTPUT_MODE) {
    settings.voice_output_mode = process.env.VOICE_OUTPUT_MODE;
}
if (process.env.VOICE_BRIDGE_HOST) {
    settings.voice_bridge_host = process.env.VOICE_BRIDGE_HOST;
}
if (process.env.VOICE_BRIDGE_PORT) {
    settings.voice_bridge_port = Number(process.env.VOICE_BRIDGE_PORT);
}
if (process.env.VOICE_STREAMING) {
    settings.voice_streaming = process.env.VOICE_STREAMING !== 'false';
}
if (process.env.VOICE_TARGET_SAMPLE_RATE) {
    settings.voice_target_sample_rate = Number(process.env.VOICE_TARGET_SAMPLE_RATE);
}
if (process.env.VOICE_INPUT_ENABLED) {
    settings.voice_input_enabled = process.env.VOICE_INPUT_ENABLED !== 'false';
}
if (process.env.VOICE_INPUT_ECHO_TO_CHAT) {
    settings.voice_input_echo_to_chat = process.env.VOICE_INPUT_ECHO_TO_CHAT !== 'false';
}
if (process.env.VOICE_INPUT_STT_MODEL) {
    settings.voice_input_stt_model = process.env.VOICE_INPUT_STT_MODEL;
}
if (process.env.VOICE_INPUT_STT_URL) {
    settings.voice_input_stt_url = process.env.VOICE_INPUT_STT_URL;
}
if (process.env.VOICE_INPUT_LANGUAGE) {
    settings.voice_input_language = process.env.VOICE_INPUT_LANGUAGE;
}
if (process.env.VOICE_INPUT_PROMPT) {
    settings.voice_input_prompt = process.env.VOICE_INPUT_PROMPT;
}
if (process.env.VOICE_INPUT_END_SILENCE_MS) {
    settings.voice_input_end_silence_ms = Number(process.env.VOICE_INPUT_END_SILENCE_MS);
}
if (process.env.VOICE_INPUT_MIN_DURATION_MS) {
    settings.voice_input_min_duration_ms = Number(process.env.VOICE_INPUT_MIN_DURATION_MS);
}
if (process.env.VOICE_INPUT_MAX_DURATION_MS) {
    settings.voice_input_max_duration_ms = Number(process.env.VOICE_INPUT_MAX_DURATION_MS);
}
if (process.env.VOICE_INPUT_TRIGGER_COOLDOWN_MS) {
    settings.voice_input_trigger_cooldown_ms = Number(process.env.VOICE_INPUT_TRIGGER_COOLDOWN_MS);
}
if (process.env.SETTINGS_JSON) {
    try {
        Object.assign(settings, JSON.parse(process.env.SETTINGS_JSON));
    } catch (err) {
        console.error("Failed to parse environment variable for SETTINGS_JSON:", err);
    }
}


Mindcraft.init(false, settings.mindserver_port, settings.auto_open_ui);

for (let profile of settings.profiles) {
    const profile_json = JSON.parse(readFileSync(profile, 'utf8'));
    settings.profile = profile_json;
    Mindcraft.createAgent(settings);
}
