// Prints the résumé page to public/resume/James_Rosado_CV.pdf, the file behind its "Download CV" button: builds
// the site, serves it with vite preview, and prints resume.html with headless Chromium (Playwright), using the
// page's print styles (light, everything open). Run again after changing resume.html: npm run resume-pdf
// (once per machine: npx playwright install chromium)
import { mkdirSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'public/resume/James_Rosado_CV.pdf');
mkdirSync(resolve(root, 'public/resume'), { recursive: true });

await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 4179, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
  await page.goto('http://localhost:4179/resume.html', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: out, format: 'Letter', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#6b7280;padding:0 13mm;display:flex;justify-content:space-between">'
      + '<span>James M. Rosado, Ph.D. · jarosado0911@gmail.com</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  });
  copyFileSync(out, resolve(root, 'dist/resume/James_Rosado_CV.pdf'));   // the built site has it too
  console.log('wrote', out);
} finally {
  await browser.close();
  server.httpServer.close();
}
