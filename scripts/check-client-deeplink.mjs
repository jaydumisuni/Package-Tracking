import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../public/maya-override.js',import.meta.url),'utf8');
new Function(source);

assert.match(source,/params\.get\('id'\)/,'client deep link must accept ?id=');
assert.match(source,/params\.get\('track'\)/,'client deep link may accept ?track= compatibility');
assert.match(source,/url\.searchParams\.set\('id'/,'shared link must contain the TTG reference');
assert.doesNotMatch(source,/searchParams\.set\(['"]phone['"]/,'shared link must never contain a client phone number');
assert.match(source,/Copy tracking link/,'tracking result must expose a copy-link action');
assert.match(source,/searchForm\.requestSubmit\(\)/,'opening a direct link must automatically run the D1 lookup');
assert.match(source,/resultArea\?\.hidden/,'URL synchronization must require a visible validated D1 result');

console.log('CLIENT_TRACKING_DEEPLINK_OK');
