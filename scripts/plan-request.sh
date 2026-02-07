#!/usr/bin/env bash
# Push a plan.request event with a prd_path.
# Usage: deno task plan-request <prd-file>
set -euo pipefail

prd_path="${1:?Usage: deno task plan-request <prd-file>}"
deno task event-queue push --worker user --type plan.request --payload "{\"prd_path\":\"$prd_path\"}"
