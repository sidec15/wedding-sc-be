#!/usr/bin/env bash
set -euo pipefail

# ====== Defaults ======
LAMBDA_FOLDER="${1:-email-dispatcher}"
LAMBDA_NAME="${2:-email-dispatcher}"
AWS_REGION="${AWS_REGION:-eu-central-1}"

echo "=== Testing Lambda build locally ==="
echo "Lambda folder: $LAMBDA_FOLDER"
echo "Lambda name:   $LAMBDA_NAME"
echo "AWS region:    $AWS_REGION"
echo

# ====== Step 1 – Install root dependencies ======
echo ">>> Installing root dependencies (workspaces)..."
echo ">>>> npm ci"
npm ci

# ====== Step 2 – Build common ======
echo ">>> Building common..."
echo ">>>> npm run build:common"
npm run build:common

# ====== Step 3 – Build lambda ======
echo ">>> Building lambda: $LAMBDA_FOLDER ..."
echo ">>>> npx tsc -b lambdas/${LAMBDA_FOLDER}"
npx tsc -b "lambdas/${LAMBDA_FOLDER}"

# ====== Step 4 – Pack common ======
# Build common explicitly before pack
echo ">>> Building common for tarball..."
echo ">>>> npm run build --workspace common"
npm run build --workspace common

echo ">>> Packing common module..."
echo ">>>> npm pack --silent ./common"
TARBALL="$(npm pack --silent ./common | tail -n1 | tr -d '\r')"
echo "Packed tarball: $TARBALL"

# Verify dist exists in tarball
if command -v tar >/dev/null 2>&1; then
  if ! tar -tzf "$TARBALL" | grep -q '^package/dist/'; then
    echo "❌ Tarball $TARBALL does not contain dist/. Check common/package.json files."
    exit 1
  fi
fi

# ====== Step 5 – Install prod deps in lambda folder ======
echo ">>> Installing prod dependencies for lambda..."
echo ">>>> cd lambdas/${LAMBDA_FOLDER}"
cd "lambdas/${LAMBDA_FOLDER}"

echo ">>>> rm -rf node_modules"
rm -rf node_modules

echo ">>>> npm ci --omit=dev"
npm ci --omit=dev

echo ">>>> npm install --omit=dev ../../${TARBALL}"
npm install --omit=dev "../../${TARBALL}"

# Check that dist exists after install
if [[ ! -f "node_modules/@wedding/common/dist/index.js" ]]; then
  echo "❌ @wedding/common dist missing in lambda"
  exit 1
fi

# ====== Step 6 – Create deployment ZIP ======
FILES=(dist node_modules package.json)
if [[ -f ".env" ]]; then
  FILES+=(".env")
fi

echo ">>> Creating deployment ZIP..."
echo ">>>> rm -f function.zip"
rm -f function.zip

if command -v zip >/dev/null 2>&1; then
  echo ">>>> zip -r function.zip ${FILES[*]} -x \"**/*.map\""
  zip -r function.zip "${FILES[@]}" -x "**/*.map" || true
elif command -v 7z >/dev/null 2>&1; then
  echo ">>>> 7z a -tzip function.zip ${FILES[*]} -x!*.map"
  7z a -tzip function.zip "${FILES[@]}" -x!*.map >/dev/null
else
  echo "❌ Neither zip nor 7z found. Install one to create the archive."
  exit 1
fi

if [[ -f function.zip ]]; then
  echo "✅ ZIP created at lambdas/${LAMBDA_FOLDER}/function.zip"
  ls -lh function.zip
else
  echo "❌ ZIP not created"
  exit 1
fi

# ====== Step 7 – Cleanup tarball ======
echo ">>> Cleaning up tarball..."
echo ">>>> rm -f ../../${TARBALL}"
rm -f "../../${TARBALL}"

cd ../..

echo
echo "=== Local build test completed ==="
echo "You can inspect the ZIP or run an AWS CLI update manually if desired:"
echo "aws lambda update-function-code --function-name \"$LAMBDA_NAME\" --zip-file \"fileb://lambdas/$LAMBDA_FOLDER/function.zip\" --publish --region $AWS_REGION"
