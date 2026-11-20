import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer-core';

function resolverRutaNavegador(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter((p): p is string => Boolean(p && p.trim()));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('No se encontró Google Chrome o Microsoft Edge instalado para generar el PDF. Configure CHROME_PATH.');
}

export async function generarFacturaPDFBuffer(html: string): Promise<Buffer> {
  const executablePath = resolverRutaNavegador();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load', timeout: 8000 });
    } catch {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
    }
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
