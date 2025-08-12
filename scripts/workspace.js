#!/usr/bin/env node
const { readdirSync, statSync, existsSync, readFileSync } = require("fs");
const { join } = require("path");
const { spawn } = require("child_process");

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", cyan: "\x1b[36m",
};

function help(code = 0) {
  console.log(
`Usage:
  node scripts/workspace.js --mode <clean|install>

Options:
  -m, --mode   clean | install
  -h, --help   Show help

What it does:
  - clean:   runs "npm run clean:all" in /common and each /lambdas/* that has package.json
  - install: runs "npm i" in the same folders`
  );
  process.exit(code);
}

function parseArgs(argv) {
  let mode = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") help(0);
    if (a === "-m" || a === "--mode") mode = argv[++i];
  }
  if (!["clean", "install"].includes(mode)) help(1);
  return { mode };
}

function hasScript(pkgJsonPath, scriptName) {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    return pkg.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, scriptName);
  } catch {
    return false;
  }
}

function findTargets(root) {
  const targets = [];
  const common = join(root, "common");
  if (existsSync(join(common, "package.json"))) {
    targets.push({ name: "common", dir: common });
  }

  const lambdasRoot = join(root, "lambdas");
  if (existsSync(lambdasRoot)) {
    for (const entry of readdirSync(lambdasRoot)) {
      if (entry === "node_modules") continue;
      const dir = join(lambdasRoot, entry);
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(join(dir, "package.json"))) continue;
      targets.push({ name: `lambdas/${entry}`, dir });
    }
  }
  return targets;
}

function run(cwd, cmd, args) {
  return new Promise((resolve, reject) => {
    const exe = process.platform === "win32" ? cmd : cmd; // don't append .cmd when shell: true
    const child = spawn(exe, args, {
      cwd,
      stdio: "inherit",
      shell: true // <-- allow bash to resolve npm
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} -> ${code}`))));
  });
}

async function runTarget(t, mode) {
  console.log(`${C.cyan}→ ${t.name}${C.reset}`);
  if (mode === "clean") {
    const pkgPath = join(t.dir, "package.json");
    if (!hasScript(pkgPath, "clean:all")) {
      console.log(`${C.dim}skip: no "clean:all" script${C.reset}\n`);
      return;
    }
    console.log(`${C.dim}npm run clean:all${C.reset}`);
    await run(t.dir, "npm", ["run", "clean:all"]);
  } else {
    console.log(`${C.dim}npm i${C.reset}`);
    await run(t.dir, "npm", ["i"]);
  }
  console.log(`${C.green}✓ done ${t.name}${C.reset}\n`);
}

(async () => {
  const { mode } = parseArgs(process.argv);
  const targets = findTargets(process.cwd());
  if (!targets.length) {
    console.error(`${C.red}No targets found (common or lambdas/*).${C.reset}`);
    process.exit(1);
  }
  console.log(`${C.yellow}Mode:${C.reset} ${mode}\n`);
  for (const t of targets) {
    try {
      await runTarget(t, mode);
    } catch (e) {
      console.error(`${C.red}✗ ${t.name}: ${e.message}${C.reset}`);
      process.exit(1);
    }
  }
  console.log(`${C.green}All done.${C.reset}`);
})();
