/**
 * Sync Console default run options from .actor/actor.json to the Apify platform.
 *
 * GitHub webhook builds and apify push deploy source only; they do not update
 * Actor.defaultRunOptions. Run this after deploy (see .github/workflows/apify-deploy.yml).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const actorJsonPath = join(process.cwd(), '.actor', 'actor.json');
const actorJson = JSON.parse(readFileSync(actorJsonPath, 'utf8'));

const token = process.env.APIFY_TOKEN;
if (!token) {
    console.error('APIFY_TOKEN is required.');
    process.exit(1);
}

const actorId =
    process.env.APIFY_ACTOR_ID ??
    (process.env.APIFY_USERNAME
        ? `${process.env.APIFY_USERNAME}/${actorJson.name}`
        : actorJson.name);

const runOptions = actorJson.defaultRunOptions ?? {};
const memoryMbytes = runOptions.memoryMbytes ?? actorJson.defaultMemoryMbytes;
const timeoutSecs = runOptions.timeoutSecs;
const build = runOptions.build ?? actorJson.buildTag ?? 'latest';

if (!memoryMbytes || !timeoutSecs) {
    console.error('actor.json must define defaultRunOptions.memoryMbytes and defaultRunOptions.timeoutSecs.');
    process.exit(1);
}

const body = {
    defaultRunOptions: {
        build,
        memoryMbytes,
        timeoutSecs,
    },
};

const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}?token=${encodeURIComponent(token)}`;
const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
});

if (!response.ok) {
    const text = await response.text();
    console.error(`Failed to sync default run options (${response.status}): ${text}`);
    process.exit(1);
}

const actor = await response.json();
console.log(
    `Synced default run options for ${actorId}: ${memoryMbytes} MB memory, ${timeoutSecs}s timeout, build ${build}.`,
);
