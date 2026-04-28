#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

resolve_java21_home() {
  if [ -n "${JAVA21_HOME:-}" ] && [ -x "${JAVA21_HOME}/bin/java" ]; then
    echo "$JAVA21_HOME"
    return 0
  fi

  if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ] && "$JAVA_HOME/bin/java" -version 2>&1 | head -n 1 | grep -q 'version "21'; then
    echo "$JAVA_HOME"
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

  for candidate in \
    /usr/lib/jvm/java-21-openjdk-* \
    /usr/lib/jvm/temurin-21-jdk-* \
    /usr/lib/jvm/jdk-21*; do
    if [ -x "${candidate}/bin/java" ] && "${candidate}/bin/java" -version 2>&1 | head -n 1 | grep -q 'version "21'; then
      echo "$candidate"
      return 0
    fi
  done

  if command -v java >/dev/null 2>&1 && java -version 2>&1 | head -n 1 | grep -q 'version "21'; then
    local java_home
    java_home="$(java -XshowSettings:properties -version 2>&1 | awk -F= '/java.home =/ {gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2; exit}')"
    if [ -n "$java_home" ] && [ -x "${java_home}/bin/java" ]; then
      echo "$java_home"
      return 0
    fi
  fi

  return 1
}

JAVA21_HOME="$(resolve_java21_home || true)"

if [ -z "$JAVA21_HOME" ]; then
  echo "错误：未找到 Java 21。请先安装 JDK 21，或设置 JAVA21_HOME/JAVA_HOME 指向 JDK 21。"
  exit 1
fi

export JAVA_HOME="$JAVA21_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

if ! command -v mvn >/dev/null 2>&1; then
  echo "错误：未找到 Maven。Ubuntu 可执行：sudo apt-get install -y maven"
  exit 1
fi

MAVEN_REPO_LOCAL="${MAVEN_REPO_LOCAL:-$SCRIPT_DIR/.m2/repository}"
MAVEN_SETTINGS_FILE="${MAVEN_SETTINGS_FILE:-$SCRIPT_DIR/mindcraft-voice-bridge/maven-settings.xml}"
mkdir -p "$MAVEN_REPO_LOCAL"

echo "当前 Java 版本："
java -version

echo "使用 Maven 构建 mindcraft-voice-bridge..."
mvn -gs "$MAVEN_SETTINGS_FILE" -s "$MAVEN_SETTINGS_FILE" -Dmaven.repo.local="$MAVEN_REPO_LOCAL" -f mindcraft-voice-bridge/pom.xml clean package "$@"
