const esbuild = require('esbuild');
const { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } = require('fs');
const path = require('path');

// --- Configuration ---
const BUILD_DIR = 'dist';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Recursively copy srcDir → dstDir */
function copyDirSync(srcDir, dstDir) {
  if (!existsSync(srcDir)) {
    console.warn(`[WARNING] Dir not found, skipping: ${srcDir}`);
    return;
  }
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, entry);
    const dstPath = path.join(dstDir, entry);
    statSync(srcPath).isDirectory()
      ? copyDirSync(srcPath, dstPath)
      : copyFileSync(srcPath, dstPath);
  }
}

/** Copy a single file, creating parent_dir as needed */
function copyFileSafe(src, dst) {
  if (!existsSync(src)) {
    console.warn(`[WARNING] Not found, skipping: ${src}`);
    return;
  }
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`[copy]   ${src}`);
}

// ─── Build Steps ─────────────────────────────────────────────────────────────

/**
 * background.js: single entry → esbuild processes it.
 * (Use this when background.js gains ES module imports in the future.)
 */
async function buildBackground() {
  console.log('[esbuild] Processing background.js...');
  await esbuild.build({
    entryPoints: ['./background.js'],
    bundle: true,
    outfile: `${BUILD_DIR}/background.js`,
    minify: false,
    sourcemap: false,
    format: 'iife',
    target: ['chrome88'],
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function build() {
  console.log('--- Starting Build Process ---');
  mkdirSync(BUILD_DIR, { recursive: true });

  // 1. Process background.js with esbuild
  await buildBackground();

  // 2. Copy popup entry point + all popup-*.js scripts
  //    (popup.html loads these individually via <script defer src="...">)
  const POPUP_SCRIPTS = [
    'popup.html',
    'popup.css',
    'popup-voice-test.js',
    'popup-ui-lang.js',
    'popup-fix.js',
    'popup-sync.js',
    'popup-names.js',
    'popup-subs.js',
    'popup-ollam.js',
    'popup-dubbing.js',
    'popup-tabs.js',
    'popup-bootstrap.js',
  ];
  for (const f of POPUP_SCRIPTS) {
    copyFileSafe(`./${f}`, `${BUILD_DIR}/${f}`);
  }

  // 3. Copy content scripts declared in manifest.json content_scripts[].js
  //    (loaded individually by Chrome; these are IIFE scripts, not ES modules)
  const CONTENT_SCRIPTS = [
    'content-bundle.js',
    'ga-bundle.js',
    'subtitles-data.js',
    'subtitles-reader.js',
    'subtitle_fixer.js',
    'fallback_webpage.js',
    'fallback_webpage.css',
  ];
  for (const f of CONTENT_SCRIPTS) {
    copyFileSafe(`./${f}`, `${BUILD_DIR}/${f}`);
  }

  // 4. Copy web_accessible_resources
  const WEB_ACCESSIBLE = [
    'message_shim.js',
    'voices_helper.js',
    'debug_probe.js',
  ];
  for (const f of WEB_ACCESSIBLE) {
    copyFileSafe(`./${f}`, `${BUILD_DIR}/${f}`);
  }

  // 5. Copy manifest.json
  copyFileSafe('./manifest.json', `${BUILD_DIR}/manifest.json`);

  // 6. Copy src/ tree (all dubbing engine files)
  console.log('[copy]   src/');
  copyDirSync('./src', `${BUILD_DIR}/src`);

  // 7. Copy _locales/ tree (i18n messages)
   console.log('[copy]   _locales/');
   copyDirSync('./_locales', `${BUILD_DIR}/_locales`);

  // 8. Copy assets/ tree (icons)
  console.log('[copy]   assets/');
  copyDirSync('./assets', `${BUILD_DIR}/assets`);

  console.log('--- Build Complete ---');
}

build().catch(err => {
  console.error('[esbuild] BUILD FAILED:', err);
  process.exit(1);
});