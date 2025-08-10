const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const commonPkgPath = path.join(root, 'common', 'package.json');
const lambdasRoot = path.join(root, 'lambdas');

const common = JSON.parse(fs.readFileSync(commonPkgPath, 'utf8'));
const newRange = `^${common.version}`;

for (const name of fs.readdirSync(lambdasRoot)) {
  const pkgPath = path.join(lambdasRoot, name, 'package.json');
  if (!fs.existsSync(pkgPath)) continue;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};

  if (pkg.dependencies['@wedding/common']) {
    if (pkg.dependencies['@wedding/common'] !== newRange) {
      pkg.dependencies['@wedding/common'] = newRange;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`Updated ${name} -> @wedding/common ${newRange}`);
    } else {
      console.log(`No change for ${name} (already ${newRange})`);
    }
  }
}
console.log('Done.');
