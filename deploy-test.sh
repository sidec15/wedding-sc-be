#!/usr/bin/env bash
set -euo pipefail

LAMBDA_FOLDER="${1:-email-dispatcher}"
LAMBDA_NAME="${2:-email-dispatcher}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
ZIP_PATH="${LAMBDA_NAME}.zip"

echo "=== Build & Package Lambda ==="
echo "Folder: $LAMBDA_FOLDER"
echo "Function: $LAMBDA_NAME"
echo "Region: $AWS_REGION"

# 1) Build repo + lambda
npm ci
npm run build --workspace common
npx tsc -b "lambdas/${LAMBDA_FOLDER}"

# 2) Pack common
TARBALL="$(npm pack --silent ./common | tail -n1 | tr -d '\r')"
[[ -f "$TARBALL" ]] || { echo "❌ Tarball not found"; exit 1; }

# 3) Prepare lambda dir and do an isolated install of the tarball
pushd "lambdas/${LAMBDA_FOLDER}" >/dev/null
rm -rf node_modules package-lock.json

# Install in a temp folder OUTSIDE the monorepo, then copy node_modules back
TMP_DIR="$(mktemp -d)"
pushd "$TMP_DIR" >/dev/null
npm init -y >/dev/null
npm install --omit=dev "$OLDPWD/../../${TARBALL}"
popd >/dev/null
mv "$TMP_DIR/node_modules" ./node_modules
rm -rf "$TMP_DIR"

# 4) Minimal runtime checks — if these pass, AWS will load fine
[[ -f node_modules/@wedding/common/dist/index.js ]] || { echo "❌ @wedding/common dist missing"; exit 1; }
node -e "require('@wedding/common'); require('winston'); require('luxon'); console.log('✅ deps ok')"
node -e "require('./dist/handler.js'); console.log('✅ handler loads')"

popd >/dev/null

# 5) Create ZIP in root
rm -f "$ZIP_PATH"
zip -r "$ZIP_PATH" \
  "lambdas/${LAMBDA_FOLDER}/dist" \
  "lambdas/${LAMBDA_FOLDER}/node_modules" \
  "lambdas/${LAMBDA_FOLDER}/package.json" \
  -x "**/*.map"

# 6) Clean up tarball
rm -f "$TARBALL"

echo "✅ ZIP created: $ZIP_PATH"
echo "Tip: aws lambda update-function-code --function-name \"$LAMBDA_NAME\" --zip-file \"fileb://$ZIP_PATH\" --publish --region $AWS_REGION"
