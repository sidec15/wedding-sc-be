#!/usr/bin/env bash
set -euo pipefail

LAMBDA_FOLDER="${1:-email-dispatcher}"
LAMBDA_NAME="${2:-email-dispatcher}"
AWS_REGION="${AWS_REGION:-eu-central-1}"
ZIP_PATH="${LAMBDA_NAME}.zip"

echo "=== Build & Package Lambda ==="
echo "Folder:   $LAMBDA_FOLDER"
echo "Function: $LAMBDA_NAME"
echo "Region:   $AWS_REGION"
echo

# 1) Install + build
echo ">>> npm ci (workspaces)"
npm ci
echo ">>> Build @wedding/common"
npm run build --workspace common
echo ">>> Build lambda: $LAMBDA_FOLDER"
npx tsc -b "lambdas/${LAMBDA_FOLDER}"

# 2) Pack @wedding/common (compute ABSOLUTE PATH now)
echo ">>> Pack @wedding/common"
TARBALL="$(npm pack --silent ./common | tail -n1 | tr -d '\r')"
[[ -f "$TARBALL" ]] || { echo "❌ Tarball not found"; exit 1; }
ROOT_DIR="$(pwd -P)"
TARBALL_ABS="$ROOT_DIR/$TARBALL"
echo "Tarball: $TARBALL_ABS"

# 3) Prepare lambda deps in isolated temp dir (Windows-safe)
pushd "lambdas/${LAMBDA_FOLDER}" >/dev/null
rm -rf node_modules package-lock.json

TMP_DIR="$(mktemp -d)"
PKG_JSON_PATH="$TMP_DIR/package.json"
cp package.json "$PKG_JSON_PATH"

# Use env vars so backslashes aren't treated as escapes on Windows
PKG_JSON_PATH="$PKG_JSON_PATH" COMMON_TARBALL="$TARBALL_ABS" node -e "
  const fs = require('fs');
  const pkgPath = process.env.PKG_JSON_PATH;
  const tarball = process.env.COMMON_TARBALL;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies['@wedding/common'] = tarball;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
"

pushd "$TMP_DIR" >/dev/null
echo ">>> npm install (omit dev)"
npm install --omit=dev
popd >/dev/null

# Move resolved node_modules back to the lambda folder
mv "$TMP_DIR/node_modules" ./node_modules
rm -rf "$TMP_DIR"

# 4) Minimal runtime checks — if these pass, Lambda will load fine
echo ">>> Runtime sanity checks"
[[ -f node_modules/@wedding/common/dist/index.js ]] || { echo '❌ @wedding/common dist missing'; exit 1; }
node -e "require('@wedding/common'); require('nodemailer'); console.log('✅ deps ok')"
node -e "require('./dist/handler.js'); console.log('✅ handler loads')"

popd >/dev/null

# 5) Create ZIP in root
echo ">>> Creating ZIP at root: $ZIP_PATH"
rm -f "$ZIP_PATH"
zip -r "$ZIP_PATH" \
  "lambdas/${LAMBDA_FOLDER}/dist" \
  "lambdas/${LAMBDA_FOLDER}/node_modules" \
  "lambdas/${LAMBDA_FOLDER}/package.json" \
  -x "**/*.map" >/dev/null

# 6) Clean up tarball
rm -f "$TARBALL"

echo "✅ ZIP created: $ZIP_PATH"
echo "Tip: aws lambda update-function-code --function-name \"$LAMBDA_NAME\" --zip-file \"fileb://$ZIP_PATH\" --publish --region $AWS_REGION"
