#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "错误：未找到 nvm，请确认已安装在 $NVM_DIR"
  exit 1
fi

# 参考 start.sh，统一使用 Node 20。
. "$NVM_DIR/nvm.sh"
nvm use 20 >/dev/null

echo "当前 Node 版本：$(node -v)"

if [ ! -d node_modules ]; then
  echo "未检测到 node_modules，开始安装依赖..."
  npm install
fi

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

JAVA21_HOME="$(resolve_java21_home || true)"

if [ -z "$JAVA21_HOME" ]; then
  echo "错误：未找到 Java 21。请先设置 JAVA21_HOME，或安装可被 /usr/libexec/java_home -v 21 发现的 JDK 21。"
  exit 1
fi

export JAVA_HOME="$JAVA21_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

MAVEN_REPO_LOCAL="${MAVEN_REPO_LOCAL:-$SCRIPT_DIR/.m2/repository}"
MAVEN_SETTINGS_FILE="${MAVEN_SETTINGS_FILE:-$SCRIPT_DIR/mindcraft-voice-bridge/maven-settings.xml}"
mkdir -p "$MAVEN_REPO_LOCAL"

echo "当前 Java 版本："
java -version

echo "使用 Maven 构建 mindcraft-voice-bridge..."
mvn -gs "$MAVEN_SETTINGS_FILE" -s "$MAVEN_SETTINGS_FILE" -Dmaven.repo.local="$MAVEN_REPO_LOCAL" -f mindcraft-voice-bridge/pom.xml clean package "$@"
