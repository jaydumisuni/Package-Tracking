import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const DATABASE_NAME = 'package-tracking-db';
const BINDING = 'TRACKING_DB';
const GENERATED_CONFIG = 'wrangler.generated.toml';

function runWrangler(args, { json = false } = {}) {
  const out = execFileSync('npx', ['wrangler', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });
  return json ? JSON.parse(out) : out;
}

function findDatabase() {
  const databases = runWrangler(['d1', 'list', '--json'], { json: true });
  return databases.find((db) => db.name === DATABASE_NAME) || null;
}

console.log(`[TTG bootstrap] Looking for D1 database: ${DATABASE_NAME}`);
let database = findDatabase();

if (!database) {
  console.log(`[TTG bootstrap] ${DATABASE_NAME} does not exist; creating it.`);
  runWrangler(['d1', 'create', DATABASE_NAME]);
  database = findDatabase();
}

if (!database?.uuid) {
  throw new Error(`Could not resolve D1 database UUID for ${DATABASE_NAME}`);
}

const baseConfig = readFileSync('wrangler.toml', 'utf8').trimEnd();
const generated = `${baseConfig}\n\n[[d1_databases]]\nbinding = "${BINDING}"\ndatabase_name = "${DATABASE_NAME}"\ndatabase_id = "${database.uuid}"\n`;
writeFileSync(GENERATED_CONFIG, generated, 'utf8');

console.log(`[TTG bootstrap] Generated ${GENERATED_CONFIG} with ${BINDING} -> ${DATABASE_NAME}`);
console.log('[TTG bootstrap] Applying idempotent production schema to remote D1.');
runWrangler([
  'd1',
  'execute',
  DATABASE_NAME,
  '--remote',
  '--file=schema.sql',
  '--yes',
  '--config',
  GENERATED_CONFIG,
]);

console.log('[TTG bootstrap] D1 bootstrap complete.');
