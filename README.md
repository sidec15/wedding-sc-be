# Wedding Backend Services

![AWS Lambda](https://img.shields.io/badge/AWS_Lambda-FF9900?style=for-the-badge&logo=amazonaws&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![NPM Workspaces](https://img.shields.io/badge/NPM_Workspaces-CB3837?style=for-the-badge&logo=npm&logoColor=white)

## Project Structure

wedding-be/
├── common/               # Shared code library
│   ├── src/              # TypeScript sources
│   ├── dist/             # Compiled output
│   ├── package.json      # @wedding/common package
├── lambdas/
│   ├── contact-us/       # Contact form handler
│   ├── email-dispatcher/ # Email processing
│   └── ...              # Other Lambda functions
├── package.json         # Root workspace config
└── tsconfig.json        # Base TypeScript config

## Prerequisites

- Node.js 18+
- npm 9+ (comes with Node 18)
- AWS CLI (for deployment)

## Setup

1. Install dependencies (from project root):
   npm install

2. Build all packages:
   npm run build

## Development Workflows

### Build Specific Packages

| Command                            | Description              |
|------------------------------------|--------------------------|
| npm run build -w @wedding/common   | Build only shared code   |
| npm run build -w contact-us        | Build single Lambda      |
| npm run build -ws                  | Build all packages       |

### Run Tests (Example)
   npm test -w contact-us

## Deployment

### Deploy Single Lambda
   cd lambdas/contact-us
   zip -r lambda.zip dist/ node_modules/
   aws lambda update-function-code \
     --function-name wedding-contact-us \
     --zip-file fileb://lambda.zip

### Deploy All (via CI/CD)
   npm run deploy

## Workspace Management

### Add New Lambda
1. Create folder under lambdas/
2. Initialize package:
   cd lambdas/new-lambda
   npm init -y
3. Add to root package.json workspaces:
   "workspaces": [
     "common",
     "lambdas/*"
   ]

## Shared Code Usage

Import from common package:
   import { Logger } from '@wedding/common';
   Logger.log('Lambda initialized');

## CI/CD Integration

GitHub Actions example:
   - name: Build
     run: |
       npm ci
       npm run build
       
   - name: Deploy
     working-directory: lambdas/contact-us
     run: |
       zip -r lambda.zip dist/ node_modules/
       aws lambda update-function-code ...

## Troubleshooting

Issue: Cannot find module '@wedding/common'
Solution:
   rm -rf node_modules package-lock.json
   npm install
   npm run build -w @wedding/common

Issue: TypeScript path errors
Verify paths in Lambda's tsconfig.json points to ../../common/dist