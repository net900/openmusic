#!/usr/bin/env bash
# OpenMusic 一键部署脚本
# 用法：
#   bash deploy/deploy.sh docker        # Docker 部署（自带 Redis，推荐）
#   bash deploy/deploy.sh docker-full   # Docker 全量部署（自带 Redis + Meting）
#   bash deploy/deploy.sh source        # 源码部署（PM2 常驻进程）
#   bash deploy/deploy.sh               # 交互式选择
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

info() { printf '\033[36m[INFO]\033[0m %s\n' "$1"; }
ok()   { printf '\033[32m[OK]\033[0m %s\n' "$1"; }
warn() { printf '\033[33m[WARN]\033[0m %s\n' "$1"; }
err()  { printf '\033[31m[ERROR]\033[0m %s\n' "$1" >&2; }

require_cmd() { command -v "$1" >/dev/null 2>&1; }

print_banner() {
  cat <<'EOF'
=========================================
   OpenMusic 一键部署脚本
=========================================
EOF
}

# ---------- Docker 通用准备 ----------

check_docker() {
  if ! require_cmd docker; then
    err "未检测到 docker，请先安装：https://docs.docker.com/engine/install/"
    exit 1
  fi
  local compose_cmd
  compose_cmd="$(resolve_compose_cmd)"
  if [ -z "$compose_cmd" ]; then
    err "未检测到 docker compose（插件或独立版本均可），请先安装"
    exit 1
  fi
  echo "$compose_cmd"
}

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif require_cmd docker-compose; then
    echo "docker-compose"
  else
    echo ""
  fi
}

prepare_data_dir() {
  mkdir -p data/downloads
  [ -f data/.env ] || : > data/.env
  [ -f data/runtimeConfig.json ] || echo '{}' > data/runtimeConfig.json
  [ -f data/adminConfig.json ] || echo '{}' > data/adminConfig.json
  [ -f data/setup.lock ] || : > data/setup.lock
  if [ -s data/setup.lock ]; then
    err "data/setup.lock 非空，为避免误判安装状态已中止；如需重新安装请先清空该文件"
    exit 1
  fi
}

# ---------- Docker 精简版（不含 Meting） ----------

deploy_docker() {
  local compose_cmd
  compose_cmd="$(check_docker)"
  info "使用命令：$compose_cmd"
  prepare_data_dir

  info "启动容器（redis + openmusic）..."
  $compose_cmd up -d --build

  ok "部署完成"
  local port="${OPENMUSIC_PORT:-4000}"
  cat <<EOF

下一步：
  1. 浏览器打开 http://<服务器IP>:${port}/setup 完成首次部署向导
     - Redis 已自动配置，只需填 Meting 音源地址和站点域名
  2. 向导完成后服务会自动重启，刷新页面即可
  3. 常用命令：
     $compose_cmd logs -f openmusic   # 查看日志
     $compose_cmd down                # 停止
     $compose_cmd up -d --build       # 更新代码后重新构建启动
EOF
}

# ---------- Docker 全量版（含 Meting） ----------

deploy_docker_full() {
  local compose_cmd
  compose_cmd="$(check_docker)"
  info "使用命令：$compose_cmd -f docker-compose.full.yml"
  prepare_data_dir

  info "启动容器（redis + meting + openmusic）..."
  $compose_cmd -f docker-compose.full.yml up -d --build

  ok "部署完成（全量版，含 Meting）"
  local port="${OPENMUSIC_PORT:-4000}"
  cat <<EOF

下一步：
  1. 浏览器打开 http://<服务器IP>:${port}/setup 完成首次部署向导
     - Redis 和 Meting 已自动配置，只需填站点域名
  2. 向导完成后服务会自动重启，刷新页面即可
  3. Meting 管理后台：http://<服务器IP>:${port} 不直接暴露 Meting 端口，
     如需配置 Meting Cookie，可进入容器：
     docker exec -it \$(docker compose -f docker-compose.full.yml ps -q meting) sh
  4. 常用命令：
     $compose_cmd -f docker-compose.full.yml logs -f openmusic   # 查看日志
     $compose_cmd -f docker-compose.full.yml down                # 停止
     $compose_cmd -f docker-compose.full.yml up -d --build       # 更新后重建
EOF
}

# ---------- 源码部署 ----------

check_node_version() {
  if ! require_cmd node; then
    err "未检测到 Node.js，请先安装 Node.js >= 18：https://nodejs.org/"
    exit 1
  fi
  local major
  major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$major" -lt 18 ]; then
    err "Node.js 版本过低（当前 $(node -v)），需要 >= 18"
    exit 1
  fi
  ok "Node.js $(node -v)"
}

ensure_pm2() {
  if require_cmd pm2; then
    ok "PM2 $(pm2 -v)"
    return
  fi
  info "未检测到 PM2，正在全局安装..."
  if ! npm install -g pm2; then
    err "PM2 安装失败，请手动执行：npm install -g pm2"
    exit 1
  fi
  ok "PM2 安装完成"
}

deploy_source() {
  check_node_version
  if ! require_cmd npm; then
    err "未检测到 npm"
    exit 1
  fi

  info "安装依赖（根 / server / client）..."
  npm run install:all

  info "构建前端..."
  npm run build

  ensure_pm2

  info "使用 PM2 启动服务（deploy/ecosystem.config.cjs）..."
  pm2 start deploy/ecosystem.config.cjs
  pm2 save

  ok "部署完成"
  local port="${PORT:-4000}"
  cat <<EOF

下一步：
  1. 浏览器打开 http://<服务器IP>:${port}/setup 完成首次部署向导
     （若已存在有效 server/.env，会跳过向导）
  2. 向导完成后需要重启一次服务使 .env 生效：
     pm2 restart openmusic
  3. 常用命令：
     pm2 logs openmusic     # 查看日志
     pm2 restart openmusic  # 重启
     pm2 status             # 查看状态
  4. 如需开机自启：pm2 startup 按提示执行一次即可（pm2 save 已保存当前进程列表）
  5. 更新代码后重新部署：git pull 后再次执行本脚本（或手动 npm run build && pm2 restart openmusic）
EOF
}

# ---------- 入口 ----------

main() {
  print_banner
  local mode="${1:-}"
  if [ -z "$mode" ]; then
    echo "请选择部署方式："
    echo "  1) Docker 部署（推荐，自带 Redis）"
    echo "  2) Docker 全量部署（自带 Redis + Meting，最省心）"
    echo "  3) 源码部署（PM2，需自行提供 Redis）"
    read -r -p "输入 1、2 或 3: " choice
    case "$choice" in
      1) mode="docker" ;;
      2) mode="docker-full" ;;
      3) mode="source" ;;
      *) err "无效选择"; exit 1 ;;
    esac
  fi

  case "$mode" in
    docker)      deploy_docker ;;
    docker-full) deploy_docker_full ;;
    source)      deploy_source ;;
    *)
      err "未知部署方式：$mode（可选 docker / docker-full / source）"
      exit 1
      ;;
  esac
}

main "$@"
