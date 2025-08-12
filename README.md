# Wedding Serverless Backend

This repository contains the **serverless backend** for the Wedding project.  
It is built around **AWS Lambda functions** written in TypeScript and packaged individually for deployment.  
The backend is designed for easy development, local testing, and reliable deployment to AWS.

---

## 📂 Project Structure

```
wedding-sc-be/
├── common/                # Shared library used by multiple lambdas
│   ├── src/               # TypeScript source code
│   ├── dist/              # Compiled output (created after build)
│   ├── package.json       # Dependencies and scripts
│   └── tsconfig.json
│
├── lambdas/
│   ├── email-dispatcher/  # Lambda for sending emails
│   │   ├── src/
│   │   ├── dist/
│   │   ├── package.json   # Includes "@wedding/common": "file:../../common"
│   │   ├── tsconfig.json
│   │   └── build script: "tsc"
│   │
│   └── contact-us/        # Lambda for contact form submissions
│       ├── src/
│       ├── dist/
│       ├── package.json   # Includes "@wedding/common": "file:../../common"
│       ├── tsconfig.json
│       └── build script: "tsc"
│
├── .github/workflows/     # GitHub Actions workflows for packaging and deployment
└── README.md
```

---

## ⚙️ Adding a New Lambda

1. **Create the Lambda folder** under `lambdas/`:
   ```
   lambdas/my-new-lambda/
   ```

2. **Initialize package.json** (must depend on the shared `common` package):
   ```json
   {
     "name": "my-new-lambda",
     "version": "1.0.0",
     "main": "dist/handler.js",
     "scripts": {
       "build": "tsc",
       "build:prod": "npm run build && npm prune --production",
       "zip": "zip -r lambda.zip dist node_modules package.json"
     },
     "dependencies": {
       "@wedding/common": "file:../../common",
       "some-other-dep": "^1.2.3"
     },
     "devDependencies": {
       "typescript": "^5.0.0"
     }
   }
   ```

3. **Add TypeScript config** (`tsconfig.json`):
   ```json
   {
     "compilerOptions": {
       "target": "ES2020",
       "module": "CommonJS",
       "lib": ["ES2020"],
       "outDir": "dist",
       "rootDir": "src",
       "strict": true,
       "esModuleInterop": true,
       "moduleResolution": "node",
       "resolveJsonModule": true,
       "skipLibCheck": true,
       "composite": true
     },
     "references": [
       { "path": "../../common" }
     ],
     "include": ["src/**/*.ts"],
     "exclude": ["node_modules", "dist", "**/*.spec.ts"]
   }
   ```

4. **Implement the Lambda** in `src/handler.ts` and export `handler`.

5. **Test build locally**:
   ```bash
   cd common
   npm ci && npm run build

   cd ../lambdas/my-new-lambda
   npm ci
   npm run build:prod
   ```

6. **Deploy via GitHub Actions** by selecting the new lambda in the workflow dispatch input.

---

## 🚫 Why We Don't Use npm Workspaces

We initially considered **npm workspaces** with `nohoist` for dependency management, but there were several drawbacks:

- **No native `nohoist` support in npm**: Unlike Yarn, npm workspaces cannot prevent hoisting without hacks.
- **Incomplete Lambda packaging**: With workspaces, Lambda `node_modules/` often missed required dependencies at runtime (since hoisted packages are stored in the repo root).
- **Complex install scripts**: Ensuring `node_modules` contained the correct dependencies for each lambda required custom post-install steps and tarball packing for `@wedding/common`.
- **Slower CI/CD**: Workaround scripts increased build complexity and deployment times.

By switching to **`file:` dependencies** in each lambda's `package.json` (e.g., `"@wedding/common": "file:../../common"`):
- Each lambda has its own **complete** `node_modules` tree.
- Builds are **simpler** and **predictable**.
- Deployment ZIPs always contain all required dependencies without extra processing.

---

## 📌 Deployment Flow Summary

1. Build **common** first.
2. Install + build the lambda.
3. Zip `dist/`, `node_modules/`, and `package.json`.
4. Upload to AWS Lambda.

For details, see `.github/workflows/package-deploy-lambda.yml`.

## Workspace Utility Script

This project includes a custom Node.js script (`scripts/workspace.js`) that helps you perform bulk operations across the `common` folder and all AWS Lambda function folders under `lambdas/`.

Unlike npm workspaces, this script does **not** rely on the workspace feature — it’s fully custom to avoid AWS Lambda packaging issues.

### Features
- Run a `clean:all` script in `common` and each Lambda folder.
- Install dependencies in `common` and each Lambda folder.
- Skip folders that don’t have the required script or `package.json`.

### Available Modes
- **clean** – runs `npm run clean:all` in each target folder (if available).
- **install** – runs `npm i` in each target folder.

### Usage

You can run the script directly:
```bash
node scripts/workspace.js --mode clean
node scripts/workspace.js --mode install
```

Or use the npm scripts defined in the root `package.json`:
```bash
npm run ws:clean
npm run ws:install
npm run ws:help
```

### Options
- `-m, --mode`  : Mode to run (`clean` or `install`) — **required**.
- `-h, --help`  : Show usage help.

### Example
```bash
npm run ws:clean
```
This will:
1. Look for `package.json` in `common` and each folder inside `lambdas/`.
2. Run `npm run clean:all` in each of them if the script is defined.
3. Skip any folder missing `package.json` or `clean:all` script.

```bash
npm run ws:install
```
This will:
1. Look for `package.json` in `common` and each folder inside `lambdas/`.
2. Run `npm i` in each folder.
3. Skip any folder missing `package.json`.