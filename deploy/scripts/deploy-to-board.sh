#!/usr/bin/env bash
# 部署到 RDK 板端：把编译好的二进制 + 配置 + systemd unit 推到板子，
# 远程执行 install-on-board.sh，并重启服务。
# 本脚本在开发机运行，通过 ssh/scp 操作板子。
#
# 前置：先跑 ./deploy/scripts/build-release.sh 产出 target/aarch64-unknown-linux-gnu/release/*
# 用法：./deploy/scripts/deploy-to-board.sh <board-host> [board-user]
#   board-host   板子 ssh 主机名或 IP（如 x5-root 或 192.168.128.10）
#   board-user   可选，板子用户名（默认用 ssh config，如 x5-root 已含）
# 示例：./deploy/scripts/deploy-to-board.sh x5-root
set -euo pipefail

cd "$(dirname "$0")/../.." || exit 2

TARGET="aarch64-unknown-linux-gnu"
BINS=("probe-daemon" "probectl" "probe-http-gateway" "probe-ws-outbound")
RELEASE_DIR="target/$TARGET/release"

BOARD_HOST="${1:?用法: $0 <board-host> [board-user]}"
BOARD_USER="${2:-}"  # 为空则用 BOARD_HOST 本身（如 x5-root 这种 ssh alias）

# 拼 ssh 目标：若给了 board-user，则 user@host；否则直接用 BOARD_HOST。
SSH_TARGET="$BOARD_HOST"
if [ -n "$BOARD_USER" ]; then
  SSH_TARGET="${BOARD_USER}@${BOARD_HOST}"
fi

# 颜色
if [ -t 1 ]; then G='\033[0;32m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'; else G=''; R=''; B=''; N=''; fi

echo -e "${B}========== [1/5] 校验本地产物 ==========${N}"
for bin in "${BINS[@]}"; do
  if [ ! -f "$RELEASE_DIR/$bin" ]; then
    echo -e "${R}✗ 缺失 $RELEASE_DIR/$bin${N}"
    echo "请先跑 ./deploy/scripts/build-release.sh"
    exit 1
  fi
done
echo -e "${G}✓ 本地产物齐全${N}"
echo

echo -e "${B}========== [2/5] 推送二进制到板子 /tmp/rdk-sophon-deploy/ ==========${N}"
REMOTE_TMP="/tmp/rdk-sophon-deploy"
ssh -o ConnectTimeout=10 "$SSH_TARGET" "mkdir -p $REMOTE_TMP"
for bin in "${BINS[@]}"; do
  echo -e "${B}  scp $bin${N}"
  scp -q "$RELEASE_DIR/$bin" "$SSH_TARGET:$REMOTE_TMP/$bin"
done
echo

echo -e "${B}========== [3/5] 推送配置与 systemd unit ==========${N}"
scp -q config/config.toml "$SSH_TARGET:$REMOTE_TMP/config.toml"
scp -q systemd/probe-daemon.service "$SSH_TARGET:$REMOTE_TMP/probe-daemon.service"
scp -q deploy/scripts/install-on-board.sh "$SSH_TARGET:$REMOTE_TMP/install-on-board.sh"
echo -e "${G}✓ 配置/unit/安装脚本已推送${N}"
echo

echo -e "${B}========== [4/5] 远程执行安装脚本 ==========${N}"
ssh -o ConnectTimeout=10 "$SSH_TARGET" "sudo bash $REMOTE_TMP/install-on-board.sh"
echo

echo -e "${B}========== [5/5] 重启服务并验证 ==========${N}"
ssh -o ConnectTimeout=10 "$SSH_TARGET" "
  sudo systemctl daemon-reload
  sudo systemctl enable --now probe-daemon
  sleep 2
  echo '--- 服务状态 ---'
  sudo systemctl --no-pager --full status probe-daemon | head -n 12 || true
  echo '--- 监听端口 ---'
  ss -lnt 2>/dev/null | grep 17777 || netstat -lnt 2>/dev/null | grep 17777
"
echo
echo -e "${G}部署完成。板端 probe-daemon 已在 17777 监听。${N}"
echo "本地验证：probectl --host $BOARD_HOST:17777 state"
echo "（若 BOARD_HOST 是 ssh alias 而非 IP，请用板子 IP 替换）"
