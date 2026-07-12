#!/bin/sh
set -eu

case "${BRANDRT_API_TOKEN:-}" in
  ""|*[!A-Za-z0-9._~-]*)
    echo "BRANDRT_API_TOKEN deve usar apenas caracteres URL-safe: letras, números, ponto, sublinhado, til ou hífen." >&2
    exit 1
    ;;
esac
