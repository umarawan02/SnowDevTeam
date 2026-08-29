#!/usr/bin/env bash
# Regenerates docs/now-sdk-orientation.md from the installed @servicenow/sdk.
# Re-run ONLY when the installed @servicenow/sdk version changes.
#
# Usage:  bash servicenow/delivery-app/scripts/generate-orientation.sh
set -euo pipefail

cd "$(dirname "$0")/.."                       # servicenow/delivery-app
OUT="../../docs/now-sdk-orientation.md"
SDK_VERSION="$(pnpm exec now-sdk --version 2>/dev/null | tail -1 | tr -d '[:space:]')"

# Union of topics from `explain quickstart --list` and `explain fluent-language --list`,
# plus keys-file by name (per the now-sdk skill).
TOPICS=(
  developing-apps-guide
  fluent-overview
  keys-file
  now-config-reference
  now-id-guide
  module-guide
  data-helpers-guide
  now-ref-guide
  now-include-guide
  now-attach-guide
  now-del-guide
  override-guide
)

{
  echo "# now-sdk Orientation (cached grounding)"
  echo
  echo "> Generated from \`@servicenow/sdk\` **v${SDK_VERSION}** on $(date -u +%Y-%m-%dT%H:%M:%SZ)."
  echo "> Regenerate only when the installed SDK version changes:"
  echo "> \`bash servicenow/delivery-app/scripts/generate-orientation.sh\`"
  echo
  echo "This document is the required orientation for the now-sdk skill. Phase 1's"
  echo "Architect and Developer agent prompts reference it so Fluent code is grounded"
  echo "in the actually-installed SDK version rather than training-data memory."
  echo
  echo "---"
  echo
  echo "## Topic index"
  for t in "${TOPICS[@]}"; do echo "- [$t](#topic-$t)"; done
  echo
  echo "---"
  echo
  for t in "${TOPICS[@]}"; do
    echo "<a id=\"topic-$t\"></a>"
    echo
    echo "## explain: $t"
    echo
    echo '```text'
    pnpm exec now-sdk explain "$t" --format=raw 2>&1
    echo '```'
    echo
    echo "---"
    echo
  done
  echo "## CLI reference (real \`--help\` output)"
  echo
  for c in "" auth init build install query; do
    label="${c:-<top-level>}"
    echo "### now-sdk ${label} --help"
    echo
    echo '```text'
    if [ -z "$c" ]; then
      pnpm exec now-sdk --help 2>&1
    else
      pnpm exec now-sdk "$c" --help 2>&1
    fi
    echo '```'
    echo
  done
} > "$OUT"

echo "Wrote $OUT"
