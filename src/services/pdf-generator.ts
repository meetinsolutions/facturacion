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

  throw new Error('No se encontró Google Chrome o Chromium instalado para generar el PDF. Configure CHROME_PATH.');
}

// ==============================================================================
// CONTROLES DE CONCURRENCIA Y CACHÉ PROTEGIDA
// ==============================================================================

const MAX_CONCURRENT_PDF_GENERATIONS = 2;
let activePdfGenerations = 0;
const waitingPdfQueue: (() => void)[] = [];

// Mapa de promesas en vuelo para desduplicar peticiones simultáneas del mismo comprobante
const inFlightPdfMap = new Map<string, Promise<Buffer>>();

function adquirirRanuraGeneracion(): Promise<void> {
  if (activePdfGenerations < MAX_CONCURRENT_PDF_GENERATIONS) {
    activePdfGenerations++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waitingPdfQueue.push(resolve);
  });
}

function liberarRanuraGeneracion(): void {
  activePdfGenerations--;
  const next = waitingPdfQueue.shift();
  if (next) {
    activePdfGenerations++;
    next();
  }
}

function obtenerDirectorioCache(): string {
  const isLinux = process.platform === 'linux';
  const baseDir = isLinux ? '/var/cache/meetinfact/pdf' : path.join(process.cwd(), '.cache', 'pdf');
  if (!fs.existsSync(baseDir)) {
    try {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    } catch {
      // Fallback a directorio temporal local si no hay permisos
      const fallback = path.join(process.cwd(), '.cache', 'pdf');
      fs.mkdirSync(fallback, { recursive: true });
      return fallback;
    }
  }
  return baseDir;
}

/**
 * Genera el Buffer PDF a partir de HTML aplicando semáforo de concurrencia y timeout de 12s.
 */
export async function generarFacturaPDFBuffer(
  html: string,
  options?: { format?: 'Letter' | 'A4'; landscape?: boolean; timeoutMs?: number }
): Promise<Buffer> {
  await adquirirRanuraGeneracion();
  const executablePath = resolverRutaNavegador();
  const timeoutMs = options?.timeoutMs ?? 12000;

  let browser: any;
  try {
    const launchPromise = puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run'
      ]
    });

    // Timeout de seguridad en caso de bloqueo del motor
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout de generación PDF superado (${timeoutMs}ms).`)), timeoutMs)
    );

    browser = await Promise.race([launchPromise, timeoutPromise]);
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: 'load', timeout: 6000 });
    } catch {
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 4000 });
    }

    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: options?.format || 'Letter',
      landscape: options?.landscape ?? false,
      printBackground: true,
      preferCSSPageSize: true
    });

    return Buffer.from(pdf);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignorar fallo al cerrar */
      }
    }
    liberarRanuraGeneracion();
  }
}

/**
 * Obtiene el PDF de un comprobante desde la caché en disco protegida,
 * o lo genera y almacena atómicamente evitando trabajo duplicado concurrente.
 */
export async function obtenerOgenerarFacturaPDF(
  tenantId: string,
  clave: string,
  htmlGenerator: () => Promise<string>
): Promise<Buffer> {
  const cacheKey = `${tenantId}_${clave}`;
  const cacheDir = obtenerDirectorioCache();
  const cacheFilePath = path.join(cacheDir, `${cacheKey}.pdf`);

  // 1. Revisar si ya existe en caché válida en disco
  if (fs.existsSync(cacheFilePath)) {
    try {
      const stats = fs.statSync(cacheFilePath);
      if (stats.size > 500) {
        return fs.readFileSync(cacheFilePath);
      }
    } catch {
      /* si falla la lectura, proceder a regenerar */
    }
  }

  // 2. Si ya hay una generación en vuelo para este mismo comprobante, esperar la misma promesa
  const inFlight = inFlightPdfMap.get(cacheKey);
  if (inFlight) {
    return await inFlight;
  }

  // 3. Crear promesa de generación y registrarla en el mapa
  const genPromise = (async () => {
    try {
      const html = await htmlGenerator();
      const pdfBuffer = await generarFacturaPDFBuffer(html);

      // Guardar en caché de forma atómica
      try {
        const tempPath = `${cacheFilePath}.tmp_${Date.now()}`;
        fs.writeFileSync(tempPath, pdfBuffer, { mode: 0o600 });
        fs.renameSync(tempPath, cacheFilePath);
      } catch (err: any) {
        console.warn('[PDF CACHE] Error escribiendo caché en disco:', err.message);
      }

      return pdfBuffer;
    } finally {
      inFlightPdfMap.delete(cacheKey);
    }
  })();

  inFlightPdfMap.set(cacheKey, genPromise);
  return await genPromise;
}

/**
 * Invalida la caché en disco de un comprobante si sus datos o estilo son modificados.
 */
export function invalidarCachePDF(tenantId: string, clave: string): void {
  try {
    const cacheDir = obtenerDirectorioCache();
    const cacheFilePath = path.join(cacheDir, `${tenantId}_${clave}.pdf`);
    if (fs.existsSync(cacheFilePath)) {
      fs.unlinkSync(cacheFilePath);
    }
  } catch {
    /* ignorar */
  }
}
