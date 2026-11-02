#!/bin/bash
set -u
prompt="$1"
log="$2"
shift 2
cd "$(dirname "$0")/.."
args=()
for image in "$@"; do
  args+=("--image=$image")
done
models="${CODEX_MODELS:-gpt-6.1-sol}"
for attempt in 1 2 3 4 5 6; do
  for model in $models; do
    codex exec -m "$model" -c model_reasoning_effort='"xhigh"' -c service_tier='"default"' -C . -s workspace-write ${args[@]+"${args[@]}"} - < "$prompt" > "$log" 2>&1
    code=$?
    if grep -iE "usage limit" "$log" | grep -qvE "grep|echo"; then
      echo "USAGE LIMIT" >> "$log"
      exit 3
    fi
    if [ "$code" -ne 0 ] && grep -q -E "at capacity|Too Many Requests|rate limit|stream disconnected" "$log"; then
      continue
    fi
    if grep -q -E "at capacity|not supported when using Codex with a ChatGPT account|Too Many Requests|rate limit" "$log" && ! grep -q -x codex "$log"; then
      continue
    fi
    echo "MODEL $model EXIT $code" >> "$log"
    exit "$code"
  done
  sleep $((30 * attempt))
done
echo "GAVE UP" >> "$log"
exit 1
