import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const isWatch = process.argv.includes('--watch');

// Copy static assets to dist/
function copyStatic() {
  mkdirSync('dist/icons', { recursive: true });

  copyFileSync('manifest.json', 'dist/manifest.json');
  copyFileSync('popup.html', 'dist/popup.html');

  for (const file of readdirSync('icons')) {
    copyFileSync(join('icons', file), join('dist/icons', file));
  }

  // Copy CSS files if they exist
  if (existsSync('src/content/vibe.css')) {
    copyFileSync('src/content/vibe.css', 'dist/vibe.css');
  }

  console.log('[build] Static assets copied to dist/');
}

const buildOptions = {
  entryPoints: [
    { in: 'src/background/main.js', out: 'background' },
    { in: 'src/content/main.js', out: 'content' },
    { in: 'src/popup/popup.js', out: 'popup' },
  ],
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome120',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  copyStatic();
  await ctx.watch();
  console.log('[build] Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  copyStatic();
  console.log('[build] Done.');
}
