import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), 'amyc-cap-build-'));

const copyEntries = [
  '.env',
  'components.json',
  'eslint.config.mjs',
  'next-env.d.ts',
  'next.config.ts',
  'package.json',
  'package-lock.json',
  'postcss.config.mjs',
  'tailwind.config.ts',
  'tsconfig.json',
  'public',
  'src',
];

function shouldCopy(src) {
  const normalized = src.replaceAll('\\', '/');
  return !normalized.endsWith('/src/app/api') && !normalized.includes('/src/app/api/');
}

function copyProject() {
  for (const entry of copyEntries) {
    const from = join(root, entry);
    if (!existsSync(from)) continue;
    cpSync(from, join(tempRoot, entry), {
      recursive: true,
      filter: shouldCopy,
    });
  }

  symlinkSync(join(root, 'node_modules'), join(tempRoot, 'node_modules'), 'junction');
}

function copyOutBack() {
  const sourceOut = join(tempRoot, 'out');
  const targetOut = join(root, 'out');
  if (!existsSync(sourceOut)) return;
  rmSync(targetOut, { recursive: true, force: true });
  mkdirSync(targetOut, { recursive: true });
  cpSync(sourceOut, targetOut, { recursive: true });
}

function runBuild() {
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npx';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npx next build --webpack']
    : ['next', 'build', '--webpack'];
  return spawnSync(command, args, {
    cwd: tempRoot,
    env: {
      ...process.env,
      CAPACITOR_EXPORT: '1',
    },
    stdio: 'inherit',
  });
}

try {
  copyProject();
  const result = runBuild();
  if (result.status === 0) {
    copyOutBack();
  }
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
  console.log(`Capacitor web build workspace cleaned: ${basename(tempRoot)}`);
}
