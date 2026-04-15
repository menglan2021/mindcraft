#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="${SERVER_DIR:-$REPO_DIR/server_data/paper-1.21.6-voicechat}"
PLUGIN_JAR="$SCRIPT_DIR/target/mindcraft-voice-bridge-0.1.0.jar"

resolve_java21_home() {
  if [ -n "${JAVA21_HOME:-}" ] && [ -x "${JAVA21_HOME}/bin/java" ]; then
    echo "$JAVA21_HOME"
    return 0
  fi

  if [ -d "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home" ]; then
    echo "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home"
    return 0
  fi

  if command -v /usr/libexec/java_home >/dev/null 2>&1; then
    for spec in 21.0.8 21; do
      local candidate
      candidate="$(/usr/libexec/java_home -v "$spec" 2>/dev/null || true)"
      if [ -n "$candidate" ] && "$candidate/bin/java" -version 2>&1 | head -n 1 | grep -q 'version "21'; then
        echo "$candidate"
        return 0
      fi
    done
  fi

  return 1
}

resolve_paper_jar() {
  if [ -n "${PAPER_JAR:-}" ] && [ -f "$PAPER_JAR" ]; then
    echo "$PAPER_JAR"
    return 0
  fi

  local default_jar="$REPO_DIR/paper-1.21.6-48.jar"
  if [ -f "$default_jar" ]; then
    echo "$default_jar"
    return 0
  fi

  local candidate
  candidate="$(find "$REPO_DIR" -maxdepth 1 -type f -name 'paper-*.jar' | sort | tail -n 1)"
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return 0
  fi

  return 1
}

resolve_voicechat_jar() {
  if [ -n "${VOICECHAT_BUKKIT_JAR:-}" ] && [ -f "$VOICECHAT_BUKKIT_JAR" ]; then
    echo "$VOICECHAT_BUKKIT_JAR"
    return 0
  fi

  local preferred="$REPO_DIR/voicechat-bukkit-2.5.32.jar"
  if [ -f "$preferred" ]; then
    echo "$preferred"
    return 0
  fi

  local candidate
  candidate="$(find "$REPO_DIR" -maxdepth 1 -type f -name 'voicechat-bukkit-*.jar' | sort | tail -n 1)"
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return 0
  fi

  return 1
}

plugin_requires_rebuild() {
  if [ ! -f "$PLUGIN_JAR" ]; then
    return 0
  fi

  if find "$SCRIPT_DIR/src" -type f -newer "$PLUGIN_JAR" | grep -q .; then
    return 0
  fi

  if [ "$SCRIPT_DIR/pom.xml" -nt "$PLUGIN_JAR" ]; then
    return 0
  fi

  return 1
}

deploy_voicechat_plugin() {
  local selected_jar="$1"
  local plugins_dir="$SERVER_DIR/plugins"
  local disabled_dir="$plugins_dir/disabled"
  mkdir -p "$disabled_dir"

  shopt -s nullglob
  local existing
  for existing in "$plugins_dir"/voicechat-bukkit-*.jar; do
    if [ "$(basename "$existing")" != "$(basename "$selected_jar")" ]; then
      mv "$existing" "$disabled_dir/"
    fi
  done
  shopt -u nullglob

  cp "$selected_jar" "$plugins_dir/"
}

mkdir -p "$SERVER_DIR/plugins"

PAPER_JAR_PATH="$(resolve_paper_jar || true)"
if [ -z "$PAPER_JAR_PATH" ]; then
  echo "错误：未找到 Paper 服务端 jar。可通过 PAPER_JAR 指定。"
  exit 1
fi

VOICECHAT_JAR_PATH="$(resolve_voicechat_jar || true)"
if [ -z "$VOICECHAT_JAR_PATH" ]; then
  echo "错误：未找到 voicechat-bukkit 插件 jar。可通过 VOICECHAT_BUKKIT_JAR 指定。"
  exit 1
fi

export JAVA_HOME="${JAVA21_HOME:-$(resolve_java21_home)}"
export PATH="$JAVA_HOME/bin:$PATH"

if plugin_requires_rebuild; then
  echo "检测到 mindcraft-voice-bridge 需要重新构建，开始构建..."
  bash "$REPO_DIR/build-voicebridge.sh" -DskipTests
fi

if [ ! -f "$PLUGIN_JAR" ]; then
  echo "错误：未找到插件产物 $PLUGIN_JAR"
  exit 1
fi

cp "$PLUGIN_JAR" "$SERVER_DIR/plugins/"
deploy_voicechat_plugin "$VOICECHAT_JAR_PATH"
rm -rf "$SERVER_DIR/plugins/.paper-remapped"

echo "当前 Java 版本：$(java -version 2>&1 | head -n 1)"
echo "使用 Paper：$(basename "$PAPER_JAR_PATH")"
echo "使用 Voice Chat：$(basename "$VOICECHAT_JAR_PATH")"
echo "已部署插件到：$SERVER_DIR/plugins"
echo "启动本地 Paper 语音测试服..."

cd "$SERVER_DIR"
exec java -Xms2G -Xmx2G -jar "$PAPER_JAR_PATH" --nogui
