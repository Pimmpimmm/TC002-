#!/usr/bin/env bash
# Download the public GitHub release without requiring Git, then run bootstrap.
set -euo pipefail

REPOSITORY="Pimmpimmm/ulanzi-tc002-focus-clock"
BRANCH="${TC002_GITHUB_BRANCH:-main}"
DESTINATION="${TC002_INSTALL_DIR:-$HOME/ulanzi-tc002-focus-clock}"
PROJECT_URL="https://github.com/$REPOSITORY"
DOWNLOAD_URL="$PROJECT_URL/archive/refs/heads/$BRANCH.zip"
APPLY=0
REPLACE=0

alarm() { printf 'ALARM %s\n' "$*" >&2; exit 2; }

manual_download() {
  printf '请从项目 GitHub 页面手动下载 ZIP：%s\n' "$DOWNLOAD_URL" >&2
  printf '解压后在 macOS“终端”进入项目目录，运行：bash bootstrap-macos.sh --apply\n' >&2
  if command -v open >/dev/null 2>&1; then
    if open "$DOWNLOAD_URL" >/dev/null 2>&1; then
      printf '已在浏览器打开官方下载地址。\n' >&2
    else
      printf '无法自动打开浏览器，请复制上面的地址。\n' >&2
    fi
  fi
}

usage() {
  cat <<'USAGE'
用法: bash install-from-github.sh [选项]

  --apply          下载后安装依赖、验证项目、构建并打开 App
  --replace        目标目录存在时先改名备份，再安装最新副本
  --dest <path>    安装目录（默认 ~/ulanzi-tc002-focus-clock）
  -h, --help       显示帮助

默认会下载最新代码并运行 bootstrap 预演，不会安装 Homebrew 依赖。
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --replace) REPLACE=1; shift ;;
    --dest) [ $# -ge 2 ] || alarm "--dest 缺少路径"; DESTINATION="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) alarm "未知参数: $1" ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || alarm "只支持 macOS"
command -v curl >/dev/null 2>&1 || alarm "系统缺少 curl"
command -v tar >/dev/null 2>&1 || alarm "系统缺少 tar"

case "$DESTINATION" in
  "$HOME"|"/"|"") alarm "安装目录过于宽泛，请使用一个专用子目录" ;;
esac
[ ! -e "$DESTINATION" ] || [ "$REPLACE" -eq 1 ] || \
  alarm "目标目录已存在：${DESTINATION}。确认保留旧副本后，加 --replace 重试"

PARENT="$(dirname "$DESTINATION")"
if ! mkdir -p "$PARENT"; then
  manual_download
  alarm "无法写入安装目录的上级目录：$PARENT；请在本机“终端”执行安装"
fi
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/tc002-github.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM
ARCHIVE="$WORK_DIR/source.tar.gz"
EXTRACTED="$WORK_DIR/extracted"
mkdir -p "$EXTRACTED"

printf '正在从 GitHub 下载 %s（分支：%s）…\n' "$REPOSITORY" "$BRANCH"
if ! curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 \
  "https://codeload.github.com/$REPOSITORY/tar.gz/refs/heads/$BRANCH" \
  --output "$ARCHIVE"; then
  manual_download
  alarm "GitHub 自动下载失败"
fi
if ! tar -xzf "$ARCHIVE" -C "$EXTRACTED"; then
  manual_download
  alarm "下载的压缩包无法解压"
fi

SOURCE=""
for CANDIDATE in "$EXTRACTED"/*; do
  if [ -d "$CANDIDATE" ]; then SOURCE="$CANDIDATE"; break; fi
done
[ -n "$SOURCE" ] || alarm "GitHub 压缩包中没有项目目录"
for REQUIRED in bootstrap-macos.sh package-lock.json companion/verify-runtime-bundle.sh mac-app/build-app.sh; do
  [ -f "$SOURCE/$REQUIRED" ] || alarm "下载内容不完整，缺少 $REQUIRED"
done
bash "$SOURCE/companion/verify-runtime-bundle.sh"

if [ -e "$DESTINATION" ]; then
  BACKUP="${DESTINATION}.backup-$(date +%Y%m%d-%H%M%S)"
  mv "$DESTINATION" "$BACKUP"
  printf '旧目录已保留为：%s\n' "$BACKUP"
fi

mv "$SOURCE" "$DESTINATION"
trap - EXIT INT TERM
rm -rf "$WORK_DIR"
printf '代码已下载到：%s\n' "$DESTINATION"

if [ "$APPLY" -eq 1 ]; then
  exec /bin/bash "$DESTINATION/bootstrap-macos.sh" --apply
fi
exec /bin/bash "$DESTINATION/bootstrap-macos.sh"
