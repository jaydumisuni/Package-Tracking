import assert from 'node:assert/strict';
import fs from 'node:fs';

const override=fs.readFileSync(new URL('../public/maya-override.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const patch=fs.readFileSync(new URL('../public/patch.css',import.meta.url),'utf8');
const maya=fs.readFileSync(new URL('../src/maya-public.js',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/router.js',import.meta.url),'utf8');
new Function(override);new Function(app);

assert.match(html,/\/maya-override\.js\?v=20260812a/,'public Tracking page must load the current deep-link runtime');
assert.match(html,/\/app\.js\?v=20260812a/,'public Tracking page must load the current app runtime');
assert.match(override,/params\.get\('id'\)/,'client deep link must accept ?id=');
assert.match(override,/params\.get\('track'\)/,'client deep link may accept ?track= compatibility');
assert.match(override,/url\.searchParams\.set\('id'/,'shared link must contain the TTG reference');
assert.doesNotMatch(override,/searchParams\.set\(['"]phone['"]/,'shared link must never contain a client phone number');
assert.match(override,/Copy tracking link/,'tracking result must expose a copy-link action');
assert.match(override,/searchForm\.requestSubmit\(\)/,'opening a direct link must automatically run the tracking lookup');
assert.match(override,/resultArea\?\.hidden/,'URL synchronization must require a visible validated result');

assert.match(patch,/#resultArea\[hidden\][^{]*\{display:none!important\}/,'hidden tracking results must remain hidden even when dashboard CSS sets display:grid');
assert.match(app,/RESULT_TEXT_IDS\.forEach\(id=>text\(id,'—'\)\)/,'new lookup must erase all previously rendered customer values');
assert.match(app,/resetResult\(\{clearUrl:true\}\)/,'new lookup must clear the previous share/deep-link URL state');
assert.match(app,/showNotice\(title,body\)/,'failed lookups must leave a persistent customer-facing not-found state');

for(const [name,source] of [['index',html],['app',app],['override',override]]){
  assert.doesNotMatch(source,/\bD1\b/i,`${name} must not expose internal storage terminology to customers`);
}

assert.match(maya,/https:\/\/thetechguyds\.com\/api\/maya\/chat/,'Tracking Maya must use the same main-site Maya gateway');
assert.match(maya,/conversation_id/,'Tracking Maya must preserve conversation continuity');
assert.match(maya,/page_context/,'Tracking Maya must pass safe tracking page context to the shared Maya gateway');
assert.doesNotMatch(maya,/function fallback\(message\)/,'Tracking Maya must not retain the old staged intent-answer fallback');
assert.doesNotMatch(router,/serveAppWithMayaOverride/,'router must not concatenate Maya override into app.js and execute it twice');

assert.match(html,/\/ttg-brand-primary\.webp\?v=canonical-20260812/,'Tracking must use the canonical TTG company mark for its browser icon and header');
assert.doesNotMatch(html,/thetechguyds\.com\/favicon/,'Tracking must not borrow the main-site-specific browser icon');
assert.doesNotMatch(html,/\/ttg-ghost-main\.svg/,'Tracking must not use the retired local ghost placeholder');

console.log('CLIENT_TRACKING_PUBLIC_UX_OK');
