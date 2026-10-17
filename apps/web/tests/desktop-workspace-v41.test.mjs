import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isMobileResearchClient,isDesktopWorkspacePath} from '../lib/desktop-workspace-policy.ts';

const headers = value => new Headers(value);
test('Phones and tablets receive a desktop-required product policy', () => {
  for (const ua of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)',
    'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X)',
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36',
    'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36',
    'Mozilla/5.0 (Windows Phone 10.0)',
  ]) assert.equal(isMobileResearchClient(headers({'user-agent':ua})), true, ua);
  assert.equal(isMobileResearchClient(headers({'sec-ch-ua-mobile':'?1'})), true);
  assert.equal(isMobileResearchClient(headers({'sec-ch-ua-platform':'"Android"'})), true);
});
test('Desktop browsers, touch laptops and API automation are not rejected by window size', () => {
  for (const ua of ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    'Mozilla/5.0 (X11; Linux x86_64)', 'python-requests/2.32', '']) {
    assert.equal(isMobileResearchClient(headers({'user-agent':ua,'sec-ch-ua-mobile':'?0'})), false);
  }
});
test('Policy covers workspace, sign-in and sample preview, not callbacks or backend APIs', () => {
  for (const p of ['/dashboard','/dashboard/ai','/dashboard/fastq-qc','/login','/signup','/preview']) assert.ok(isDesktopWorkspacePath(p));
  for (const p of ['/','/desktop-required','/auth/callback','/auth/signout','/api/ai/chat','/api/health','/dashboard-spoof']) assert.equal(isDesktopWorkspacePath(p),false);
});
test('Desktop access policy keeps original authentication and refuses to cache a device redirect', () => {
  const proxy=readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');
  assert.match(proxy,/return updateSession\(request\)/);
  assert.match(proxy,/isMobileResearchClient\(request.headers\)/);
  assert.match(proxy,/destination.search = ""/);
  assert.match(proxy,/private, no-store/);
  assert.match(proxy,/Sec-CH-UA-Mobile/);
  assert.doesNotMatch(proxy,/innerWidth|screen.width|bypassAuth/);
});
