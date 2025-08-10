#!/usr/bin/env bash
set -euo pipefail

LAMBDA_FOLDER="${1:-email-dispatcher}"     # folder under lambdas/
LAMBDA_NAME="${2:-email-dispatcher}"       # AWS Lambda function name
AWS_REGION="${AWS_REGION:-eu-central-1}"
ZIP_PATH="${LAMBDA_NAME}.zip"

echo "=== Build & Package Lambda (nested install) ==="
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

# 2) Pack @wedding/common (ABSOLUTE PATH to avoid cwd issues)
echo ">>> Pack @wedding/common"
TARBALL="$(npm pack --silent ./common | tail -n1 | tr -d '\r')"
[[ -f "$TARBALL" ]] || { echo "❌ Tarball not found"; exit 1; }
ROOT_DIR="$(pwd -P)"
TARBALL_ABS="$ROOT_DIR/$TARBALL"
echo "Tarball: $TARBALL_ABS"

# 3) Install ONLY the lambda workspace deps using nested strategy (no hoisting)
echo ">>> npm ci (workspace lambda, nested)"
npm ci --omit=dev --workspace "lambdas/${LAMBDA_FOLDER}" --install-strategy=nested

# 4) Replace @wedding/common workspace link with real tarball (still nested)
echo ">>> Install @wedding/common tarball into lambda workspace (nested)"
rm -rf "lambdas/${LAMBDA_FOLDER}/node_modules/@wedding/common" || true
npm install --omit=dev --no-save \
  --workspace "lambdas/${LAMBDA_FOLDER}" \
  --install-strategy=nested \
  "$TARBALL_ABS"

# 5) Runtime sanity checks from inside the lambda folder
pushd "lambdas/${LAMBDA_FOLDER}" >/dev/null
[[ -f node_modules/@wedding/common/dist/index.js ]] || { echo "❌ @wedding/common dist missing"; exit 1; }
node -e "require('@wedding/common'); console.log('✅ @wedding/common loads')"
# (optional) if your handler imports other libs (e.g., nodemailer), test them too:
# node -e "require('nodemailer'); console.log('✅ nodemailer loads')"
node -e "require('./dist/handler.js'); console.log('✅ handler loads')"
popd >/dev/null

# 6) Create ZIP in root
echo ">>> Creating ZIP at root: $ZIP_PATH"
rm -f "$ZIP_PATH"
zip -r "$ZIP_PATH" \
  "lambdas/${LAMBDA_FOLDER}/dist" \
  "lambdas/${LAMBDA_FOLDER}/node_modules" \
  "lambdas/${LAMBDA_FOLDER}/package.json" \
  -x "**/*.map" >/dev/null

# 7) Clean up tarball
rm -f "$TARBALL"

echo "✅ ZIP created: $ZIP_PATH"
echo "Deploy with:"
echo "aws lambda update-function-code --function-name \"$LAMBDA_NAME\" --zip-file \"fileb://$ZIP_PATH\" --publish --region $AWS_REGION"
