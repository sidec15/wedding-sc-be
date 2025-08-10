#!/usr/bin/env bash
set -euo pipefail

LAMBDA_FOLDER="${1:-email-dispatcher}"
LAMBDA_NAME="${2:-email-dispatcher}"
AWS_REGION="${AWS_REGION:-eu-central-1}"

echo "=== Building and packaging Lambda ==="
echo "Folder: $LAMBDA_FOLDER"
echo "Function: $LAMBDA_NAME"
echo "Region: $AWS_REGION"

# Install & build
npm ci
npm run build --workspace common
npx tsc -b "lambdas/${LAMBDA_FOLDER}"

# Pack common
TARBALL="$(npm pack --silent ./common | tail -n1 | tr -d '\r')"
[[ -f "$TARBALL" ]] || { echo "❌ Tarball not found"; exit 1; }

# Prepare lambda dir
cd "lambdas/${LAMBDA_FOLDER}"
rm -rf node_modules
npm ci --omit=dev
npm install --omit=dev "../../${TARBALL}"

# Check
[[ -f node_modules/@wedding/common/dist/index.js ]] || { echo "❌ common dist missing"; exit 1; }

# Zip
rm -f function.zip
zip -r function.zip dist node_modules package.json -x "**/*.map"

cd ../..
rm -f "$TARBALL"
echo "✅ function.zip ready for $LAMBDA_NAME"
