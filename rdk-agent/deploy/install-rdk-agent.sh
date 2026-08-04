#!/usr/bin/env bash
# 将 rdk-agent 复制到用户级应用目录，安装生产依赖，并注册 rdk-agent 命令。
#
# 用法：./deploy/install-rdk-agent.sh [选项]
#   --install-dir <dir>  应用安装目录（默认 ~/.local/share/rdk-agent）
#   --bin-dir <dir>      命令安装目录（默认 ~/.local/bin）
#   --config-dir <dir>   可编辑配置目录（默认 ~/.config/rdk-agent）
#   -h, --help           显示帮助
#
# 也可通过 npm 调用：npm run deploy -- [选项]
set -euo pipefail

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
USER_HOME="${HOME:?无法确定用户家目录}"
INSTALL_DIR="$USER_HOME/.local/share/rdk-agent"
BIN_DIR="$USER_HOME/.local/bin"
CONFIG_DIR="${XDG_CONFIG_HOME:-$USER_HOME/.config}/rdk-agent"

while [ $# -gt 0 ]; do
  case "$1" in
    --install-dir)
      INSTALL_DIR="${2:?--install-dir 需要参数}"
      shift 2
      ;;
    --bin-dir)
      BIN_DIR="${2:?--bin-dir 需要参数}"
      shift 2
      ;;
    --config-dir)
      CONFIG_DIR="${2:?--config-dir 需要参数}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,9p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "未知参数: $1（用 -h 查看帮助）" >&2
      exit 2
      ;;
  esac
done

case "$INSTALL_DIR" in
  ""|/|"$USER_HOME")
    echo "错误：不安全的安装目录 '$INSTALL_DIR'" >&2
    exit 2
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "错误：找不到 Node.js；Pi SDK 要求 Node.js >= 22.19.0。" >&2
  exit 1
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)'; then
  echo "错误：当前 Node.js 为 $(node --version)，Pi SDK 要求 >= 22.19.0。" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "错误：找不到 npm。" >&2
  exit 1
fi

if [ -t 1 ]; then
  GREEN='\033[0;32m'
  BLUE='\033[0;34m'
  YELLOW='\033[0;33m'
  RESET='\033[0m'
else
  GREEN=''
  BLUE=''
  YELLOW=''
  RESET=''
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rdk-agent-deploy.XXXXXX")"
STAGED_APP="$TEMP_DIR/app"
BACKUP_DIR="${INSTALL_DIR}.backup.$$"
DEPLOYED=0
CONFIG_WAS_DEFAULT=0

cleanup() {
  if [ "$DEPLOYED" -ne 1 ] && [ -d "$BACKUP_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    mv "$BACKUP_DIR" "$INSTALL_DIR"
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

echo -e "${BLUE}========== [1/4] 校验 rdk-agent ==========${RESET}"
node --experimental-strip-types --check "$PROJECT_DIR/src/api/tui/main.ts"
echo -e "${GREEN}✓ Node.js $(node --version)，入口语法检查通过${RESET}"

echo -e "${BLUE}========== [2/4] 准备生产包 ==========${RESET}"
mkdir -p "$STAGED_APP/bin"
cp "$PROJECT_DIR/package.json" "$PROJECT_DIR/package-lock.json" "$STAGED_APP/"
cp -R "$PROJECT_DIR/src" "$PROJECT_DIR/config" "$STAGED_APP/"
# TUI 的 Skill 原子部署会在源码配置旁保留回滚备份；它们不是运行时配置，
# 不能进入用户安装包，否则会干扰后续默认配置升级检测。
find "$STAGED_APP/config/skills" -mindepth 1 -maxdepth 1 -type d -name '.*.rdk-agent-*.bak' -exec rm -rf -- {} +
cp "$PROJECT_DIR/README.md" "$STAGED_APP/"
install -m 0755 "$PROJECT_DIR/deploy/rdk-agent" "$STAGED_APP/bin/rdk-agent"
printf '%s\n' "$CONFIG_DIR" > "$STAGED_APP/config-path"
(
  cd "$STAGED_APP"
  npm ci --omit=dev --ignore-scripts
)
echo -e "${GREEN}✓ 生产依赖安装完成${RESET}"

echo -e "${BLUE}========== [3/4] 安装应用 ==========${RESET}"
if [ -d "$CONFIG_DIR" ] && [ -d "$INSTALL_DIR/config" ]; then
  CONFIG_COMPARE_DIR="$TEMP_DIR/current-config"
  cp -R "$CONFIG_DIR" "$CONFIG_COMPARE_DIR"
  # 旧安装器生成的升级示例不属于用户自定义，比较默认配置时忽略它。
  rm -f "$CONFIG_COMPARE_DIR/agents.yaml.v2.example"
  if diff -qr "$CONFIG_COMPARE_DIR" "$INSTALL_DIR/config" >/dev/null 2>&1; then
    CONFIG_WAS_DEFAULT=1
  fi
fi
mkdir -p "$(dirname -- "$INSTALL_DIR")"
if [ -e "$INSTALL_DIR" ]; then
  mv "$INSTALL_DIR" "$BACKUP_DIR"
fi
mv "$STAGED_APP" "$INSTALL_DIR"
echo -e "${GREEN}✓ 应用已安装到 $INSTALL_DIR${RESET}"
if [ ! -e "$CONFIG_DIR" ]; then
  mkdir -p "$(dirname -- "$CONFIG_DIR")"
  cp -R "$INSTALL_DIR/config" "$CONFIG_DIR"
  echo -e "${GREEN}✓ 可编辑配置已初始化到 $CONFIG_DIR${RESET}"
elif [ "$CONFIG_WAS_DEFAULT" -eq 1 ]; then
  cp -R "$INSTALL_DIR/config/." "$CONFIG_DIR/"
  echo -e "${GREEN}✓ 未修改的默认配置已升级到最新版本${RESET}"
else
  echo -e "${YELLOW}保留已有配置：$CONFIG_DIR${RESET}"
  cp "$INSTALL_DIR/config/agents.yaml" "$CONFIG_DIR/agents.yaml.v2.example"
  echo -e "${YELLOW}新的双模式配置已写入 $CONFIG_DIR/agents.yaml.v2.example，请手动合并自定义内容${RESET}"
fi

echo -e "${BLUE}========== [4/4] 注册命令 ==========${RESET}"
mkdir -p "$BIN_DIR"
if [ ! -w "$BIN_DIR" ]; then
  echo "错误：$BIN_DIR 不可写；请通过 --bin-dir 指定用户可写目录。" >&2
  exit 1
fi
ln -sfn "$INSTALL_DIR/bin/rdk-agent" "$BIN_DIR/rdk-agent"
rm -rf "$BACKUP_DIR"
DEPLOYED=1
echo -e "${GREEN}✓ 命令已安装到 $BIN_DIR/rdk-agent${RESET}"

if ! case ":$PATH:" in *":$BIN_DIR:"*) true ;; *) false ;; esac; then
  echo -e "${YELLOW}提示：$BIN_DIR 尚未加入 PATH。请将下面一行写入 shell 配置：${RESET}"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

echo
echo -e "${GREEN}部署完成。${RESET}"
echo "运行: rdk-agent"
echo "仓库贡献者模式: rdk-agent --workspace /path/to/rdk-sophon"
echo "配置: $CONFIG_DIR/agents.yaml"
