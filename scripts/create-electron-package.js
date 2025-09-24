const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const packageJson = JSON.parse(await fsp.readFile(packageJsonPath, 'utf8'));

  const platform = process.platform;
  const arch = process.arch;

  const electronDist = path.join(projectRoot, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(electronDist)) {
    throw new Error('Electron runtime not found. Have you installed dependencies?');
  }

  const releaseRoot = path.join(projectRoot, 'release');
  const releaseDir = path.join(releaseRoot, `${platform}-${arch}`);

  await fsp.rm(releaseDir, { recursive: true, force: true });
  await copyDir(electronDist, releaseDir);

  const resourcesDir = path.join(releaseDir, 'resources');
  const defaultAsar = path.join(resourcesDir, 'default_app.asar');
  if (fs.existsSync(defaultAsar)) {
    await fsp.rm(defaultAsar, { force: true });
  }

  const appDir = path.join(resourcesDir, 'app');
  await fsp.rm(appDir, { recursive: true, force: true });
  await fsp.mkdir(appDir, { recursive: true });

  const minimalPackageJson = {
    name: packageJson.name,
    productName: packageJson.productName,
    version: packageJson.version,
    main: 'main.js',
    author: packageJson.author,
    description: packageJson.description,
    license: packageJson.license,
    dependencies: packageJson.dependencies ?? {},
  };

  await fsp.writeFile(
    path.join(appDir, 'package.json'),
    JSON.stringify(minimalPackageJson, null, 2)
  );

  const filesToCopy = ['main.js', 'preload.js', 'script.py'];
  for (const file of filesToCopy) {
    const src = path.join(projectRoot, file);
    if (fs.existsSync(src)) {
      await copyItem(src, path.join(appDir, file));
    }
  }

  const distDir = path.join(projectRoot, 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('Front-end build output missing. Run `npm run build` first.');
  }
  await copyDir(distDir, path.join(appDir, 'dist'));

  const extraResourceDirs = [
    path.join(projectRoot, 'public', 'fonts'),
    path.join(projectRoot, 'src', 'assets'),
  ];

  for (const dir of extraResourceDirs) {
    if (fs.existsSync(dir)) {
      const relative = path.relative(projectRoot, dir);
      await copyDir(dir, path.join(appDir, relative));
    }
  }

  console.log(`Electron package created at ${releaseDir}`);
  console.log('To run the packaged app locally, execute the bundled electron binary with your project resources.');
}

async function copyDir(src, dest) {
  const stats = await fsp.stat(src);
  if (!stats.isDirectory()) {
    await copyItem(src, dest);
    return;
  }

  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else if (entry.isSymbolicLink()) {
        const target = await fsp.readlink(srcPath);
        await fsp.symlink(target, destPath);
      } else {
        await copyItem(srcPath, destPath);
      }
    })
  );
}

async function copyItem(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
