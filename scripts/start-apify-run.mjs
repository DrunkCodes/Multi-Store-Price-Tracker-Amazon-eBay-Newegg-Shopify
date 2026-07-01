/**
 * Start an Actor run with memory and timeout sized to the input workload.
 *
 * Usage:
 *   APIFY_TOKEN=... npm run start-apify-run -- path/to/input.json
 *   APIFY_TOKEN=... npm run start-apify-run -- --input '{"startUrls":[{"url":"..."}]}'
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    estimateProductCount,
    recommendMemoryMbytes,
    recommendTimeoutSecs,
} from '../dist/memoryTier.js';

const actorJson = JSON.parse(readFileSync(join(process.cwd(), '.actor', 'actor.json'), 'utf8'));

const token = process.env.APIFY_TOKEN;
if (!token) {
    console.error('APIFY_TOKEN is required.');
    process.exit(1);
}

const actorId =
    process.env.APIFY_ACTOR_ID ??
    (process.env.APIFY_USERNAME ? `${process.env.APIFY_USERNAME}/${actorJson.name}` : actorJson.name);

async function loadInput(argv) {
    const inputArgIndex = argv.indexOf('--input');
    if (inputArgIndex !== -1) {
        return JSON.parse(argv[inputArgIndex + 1]);
    }
    const filePath = argv.find((a) => !a.startsWith('-'));
    if (!filePath) {
        console.error('Provide input JSON file path or --input \'{"startUrls":[...]}\'');
        process.exit(1);
    }
    return JSON.parse(await readFile(filePath, 'utf8'));
}

const input = await loadInput(process.argv.slice(2));
const memoryMbytes = recommendMemoryMbytes(input);
const timeoutSecs = recommendTimeoutSecs(input);
const products = estimateProductCount(input);

console.log(`Estimated ${products} product page(s) → ${memoryMbytes} MB memory, ${timeoutSecs}s timeout`);

const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}`;
const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        memoryMbytes,
        timeoutSecs,
        build: actorJson.buildTag ?? 'latest',
        input,
    }),
});

if (!response.ok) {
    console.error(`Failed to start run (${response.status}): ${await response.text()}`);
    process.exit(1);
}

const run = await response.json();
const runId = run.data?.id ?? run.id;
console.log(`Started run ${runId} with ${memoryMbytes} MB / ${timeoutSecs}s`);
console.log(`https://console.apify.com/actors/runs/${runId}`);
