#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "错误：未找到 nvm，请确认已安装在 $NVM_DIR"
  exit 1
fi

# 加载 nvm 并切换到当前依赖要求的 Node 22。
. "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null

echo "当前 Node 版本：$(node -v)"

if [ ! -d node_modules ]; then
  echo "未检测到 node_modules，开始安装依赖..."
  npm install
fi

echo "启动 mindcraft..."
node main.js "$@"
