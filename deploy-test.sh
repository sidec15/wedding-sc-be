#!/usr/bin/env bash
set -euo pipefail

LAMBDA_FOLDER="${1:-email-dispatcher}"

echo "=== Building common ==="
cd common
npm ci
npm run build
cd ..

echo "=== Installing lambda dependencies for: $LAMBDA_FOLDER ==="
cd "lambdas/$LAMBDA_FOLDER"
npm ci
cd ../..

echo "=== Verifying dependencies ==="
check_dep() {
  local dep=$1
  if [ -d "lambdas/$LAMBDA_FOLDER/node_modules/$dep" ]; then
    echo "✅ Found $dep"
  else
    echo "❌ Missing $dep"
    exit 1
  fi
}

check_dep "@wedding/common"
check_dep "winston"
check_dep "luxon"

echo "✅ All required dependencies are installed"
