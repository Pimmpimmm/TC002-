#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec /bin/bash "$ROOT/bootstrap-macos.sh" --apply
