#!/usr/bin/env bash
# Render a template file with simple key=value substitution.
set -euo pipefail
template="$1"
shift
while [ "$#" -gt 0 ]; do
  key="${1%%=*}"
  value="${1#*=}"
  sed -i "s|{{${key}}}|${value}|g" "$template"
  shift
done
