const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist');
  const uploadsSrc = path.join(projectRoot, 'uploads');
  const uploadsDest = path.join(distDir, 'uploads');

  if (!fs.existsSync(uploadsSrc)) {
    console.warn('No uploads directory found to copy. Skipping dist uploads sync.');
    return;
  }

  if (!fs.existsSync(distDir)) {
    throw new Error('dist directory does not exist. Run the build before syncing uploads.');
  }

  await fsp.rm(uploadsDest, { recursive: true, force: true });
  await copyDir(uploadsSrc, uploadsDest);
  console.log('Copied uploads directory into dist.');
}

async function copyDir(src, dest) {
  const stats = await fsp.stat(src);
  if (!stats.isDirectory()) {
    await copyFile(src, dest);
    return;
  }

  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      const target = await fsp.readlink(srcPath);
      await fsp.symlink(target, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

async function copyFile(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest);
}

main().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
