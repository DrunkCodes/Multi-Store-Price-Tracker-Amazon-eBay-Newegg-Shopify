/**
 * Sets Node heap from Apify container memory, then starts the Actor.
 * APIFY_MEMORY_MBYTES is injected by the platform per run (1024, 2048, …).
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const containerMb = Number.parseInt(process.env.APIFY_MEMORY_MBYTES ?? '2048', 10);
const heapMb = Math.max(384, Math.floor((Number.isFinite(containerMb) && containerMb > 0 ? containerMb : 2048) * 0.62));

process.env.NODE_OPTIONS = `--max-old-space-size=${heapMb}`;

console.log(`Memory: container ${containerMb} MB → Node heap cap ${heapMb} MB (Chromium uses the rest)`);

const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
});

child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
});

child.on('error', (err) => {
    console.error(err);
    process.exit(1);
});
