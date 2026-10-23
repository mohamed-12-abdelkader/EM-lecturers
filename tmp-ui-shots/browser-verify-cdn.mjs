import pkg from '/tmp/node_modules/playwright-core/index.js';
const { chromium } = pkg;
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const SHOTS = '/home/abdulrahman/me/test/EM-lecturers/tmp-ui-shots';
const AVATAR = '/tmp/browser-cdn-avatar.jpg';
const BASE = 'https://em-online.online';

const result = {
  login_ok: false,
  put_status: null,
  avatar_url: null,
  cdn_http: null,
  cdn_bytes: null,
  notes: '',
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { Accept: 'image/*,*/*' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'] || '',
          bytes: buf.length,
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function shot(page, name) {
  const p = path.join(SHOTS, `browser-${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log('screenshot', p);
  return p;
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'ar',
  });
  const page = await context.newPage();

  let putCapture = null;

  page.on('response', async (response) => {
    try {
      const req = response.request();
      const url = response.url();
      if (req.method() === 'PUT' && /\/api\/admin\/teachers\/\d+/.test(url)) {
        const headers = req.headers();
        const ct = headers['content-type'] || '';
        let bodyText = null;
        try {
          bodyText = await response.text();
        } catch (_) {}
        let json = null;
        try {
          json = bodyText ? JSON.parse(bodyText) : null;
        } catch (_) {}
        putCapture = {
          url,
          status: response.status(),
          requestContentType: ct,
          isMultipart: ct.includes('multipart/form-data'),
          body: json,
          postData: req.postData() ? '(has postData)' : null,
        };
        console.log('PUT captured', putCapture.status, putCapture.url, 'multipart=', putCapture.isMultipart);
      }
    } catch (e) {
      console.log('response handler err', e.message);
    }
  });

  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/api\/admin\/teachers\/\d+/.test(req.url())) {
      const ct = req.headers()['content-type'] || '';
      console.log('PUT request', req.url(), 'ct=', ct);
      // Inspect multipart via form-looking fields if available
      try {
        const fd = req.postDataBuffer?.();
        if (fd) console.log('PUT body bytes', fd.length);
      } catch (_) {}
    }
  });

  try {
    // 1. Login
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    await shot(page, '01-login');

    // Fill login — try common selectors
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="بريد"]',
      'input[placeholder*="email" i]',
      'input[type="text"]',
    ];
    const passSelectors = [
      'input[type="password"]',
      'input[name="password"]',
    ];

    let emailFilled = false;
    for (const sel of emailSelectors) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.fill('emonline@gmail.com');
        emailFilled = true;
        break;
      }
    }
    if (!emailFilled) throw new Error('Could not find email input');

    let passFilled = false;
    for (const sel of passSelectors) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.fill('emadmin111');
        passFilled = true;
        break;
      }
    }
    if (!passFilled) throw new Error('Could not find password input');

    // Click login button
    const loginBtn = page.getByRole('button', { name: /دخول|تسجيل|login|sign in/i }).first();
    if (await loginBtn.count()) {
      await loginBtn.click();
    } else {
      await page.locator('button[type="submit"]').first().click();
    }

    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, '02-after-login');

    const urlAfter = page.url();
    result.login_ok = !urlAfter.includes('/login');
    if (!result.login_ok) {
      // maybe still on login with error
      const bodyText = await page.locator('body').innerText().catch(() => '');
      result.notes = `Login failed; still on ${urlAfter}. Body snippet: ${bodyText.slice(0, 200)}`;
      throw new Error(result.notes);
    }
    console.log('login_ok', result.login_ok, 'url', urlAfter);

    // 2. Go to management
    await page.goto(`${BASE}/admin/management`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000);
    await shot(page, '03-management');

    // 3. Open edit modal — look for تعديل buttons
    // Prefer row with a teacher that has edit button
    const editCandidates = [
      page.getByRole('button', { name: /تعديل بيانات المدرس/ }),
      page.getByRole('button', { name: /تعديل/ }),
      page.locator('button:has-text("تعديل")'),
      page.locator('[aria-label*="تعديل"]'),
      page.locator('button:has-text("Edit")'),
    ];

    let opened = false;
    for (const cand of editCandidates) {
      const count = await cand.count();
      if (count > 0) {
        await cand.first().click();
        opened = true;
        break;
      }
    }

    if (!opened) {
      // Try clicking edit icons in table
      const icons = page.locator('table button, [class*="edit"], svg').filter({ hasText: /تعديل|Edit/ });
      if (await icons.count()) {
        await icons.first().click();
        opened = true;
      }
    }

    if (!opened) {
      // Dump buttons for debugging
      const buttons = await page.locator('button').allTextContents();
      result.notes = `No edit button found. Buttons: ${buttons.slice(0, 40).join(' | ')}`;
      await shot(page, '03b-no-edit');
      throw new Error(result.notes);
    }

    await page.waitForTimeout(1500);
    await shot(page, '04-edit-modal');

    // Verify modal title if present
    const modalVisible = await page.getByText(/تعديل بيانات المدرس/).count();
    console.log('modal title count', modalVisible);

    // 4. Select avatar file
    const fileInput = page.locator('input[type="file"]').first();
    if (!(await fileInput.count())) {
      result.notes = 'No file input in edit modal';
      throw new Error(result.notes);
    }
    await fileInput.setInputFiles(AVATAR);
    await page.waitForTimeout(1000);
    await shot(page, '05-avatar-selected');

    // 5. Click save
    const saveBtn = page.getByRole('button', { name: /حفظ التغييرات/ }).first();
    if (await saveBtn.count()) {
      await saveBtn.click();
    } else {
      const alt = page.locator('button:has-text("حفظ")').first();
      if (await alt.count()) await alt.click();
      else throw new Error('Save button not found');
    }

    // Wait for PUT
    const deadline = Date.now() + 45000;
    while (!putCapture && Date.now() < deadline) {
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);
    await shot(page, '06-after-save');

    if (!putCapture) {
      result.notes = 'PUT /api/admin/teachers/:id was not observed';
      throw new Error(result.notes);
    }

    result.put_status = putCapture.status;
    const avatarUrl =
      putCapture.body?.data?.avatar ||
      putCapture.body?.avatar ||
      putCapture.body?.data?.teacher?.avatar ||
      null;
    result.avatar_url = avatarUrl;

    const notes = [];
    notes.push(`PUT multipart=${putCapture.isMultipart} ct=${putCapture.requestContentType.slice(0, 80)}`);
    if (putCapture.status !== 200) notes.push(`PUT not 200: ${JSON.stringify(putCapture.body)?.slice(0, 200)}`);
    if (!avatarUrl) notes.push('No avatar URL in response');
    else if (!avatarUrl.includes('/cdn/teachers/')) notes.push('avatar URL missing /cdn/teachers/');

    // 8. GET CDN URL
    if (avatarUrl) {
      const cdn = await fetchUrl(avatarUrl);
      result.cdn_http = cdn.status;
      result.cdn_bytes = cdn.bytes;
      notes.push(`CDN content-type=${cdn.contentType}`);
      if (cdn.status !== 200) notes.push('CDN not 200');
      if (!/^image\//i.test(cdn.contentType)) notes.push('CDN not image/*');
      if (cdn.bytes <= 1024) notes.push('CDN bytes <= 1KB');
    }

    result.notes = notes.join('; ');
    console.log('RESULT', JSON.stringify(result, null, 2));
  } catch (e) {
    result.notes = (result.notes ? result.notes + '; ' : '') + `Error: ${e.message}`;
    try {
      await shot(page, '99-error');
    } catch (_) {}
    console.error(e);
  } finally {
    fs.writeFileSync(path.join(SHOTS, 'browser-result.json'), JSON.stringify(result, null, 2));
    await browser.close();
  }

  // Exit non-zero if verification failed
  const ok =
    result.login_ok &&
    result.put_status === 200 &&
    result.avatar_url &&
    String(result.avatar_url).includes('/cdn/teachers/') &&
    result.cdn_http === 200 &&
    result.cdn_bytes > 1024;
  process.exit(ok ? 0 : 1);
}

main();
