#!/usr/bin/env node

/**
 * dsh-vue-auth-analyzer CLI entry point.
 *
 * Usage:
 *   npx dsh-vue-auth-analyzer --run-ai          # Full analysis (static + AI)
 *   npx dsh-vue-auth-analyzer --static-only     # Static AST analysis only
 *   npx dsh-vue-auth-analyzer --prepare-ai      # Prepare AI task files
 *   npx dsh-vue-auth-analyzer --merge-ai        # Merge AI + static results
 *   npx dsh-vue-auth-analyzer --help            # Show help
 *
 * All flags are forwarded to scripts/vue-auth-api-analyzer.mjs.
 * The script runs in the current working directory (your Vue project root).
 */

import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, '..', 'scripts', 'vue-auth-api-analyzer.mjs');

if (!existsSync(scriptPath)) {
  console.error('❌ Cannot find analyzer script at:', scriptPath);
  console.error('   Make sure dsh-vue-auth-analyzer is installed correctly.');
  process.exit(1);
}

// Forward all CLI arguments to the analyzer script
const args = process.argv.slice(2);

const child = spawn(process.execPath, [scriptPath, ...args], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: { ...process.env },
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('❌ Failed to start analyzer:', err.message);
  process.exit(1);
});

// Forward signals
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    child.kill(sig);
  });
}