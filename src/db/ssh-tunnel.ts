import { spawn, ChildProcess } from 'child_process';
import net from 'net';
import dotenv from 'dotenv';

dotenv.config();

let tunnelProcess: ChildProcess | null = null;

function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function cleanup() {
  if (tunnelProcess && !tunnelProcess.killed) {
    try { tunnelProcess.kill(); } catch { /* ignore */ }
  }
  tunnelProcess = null;
}

/**
 * Abre un túnel SSH (plink en Windows, ssh en otros SO) hacia PostgreSQL en la VPS
 * si SSH_TUNNEL_ENABLED=true. Si el puerto local ya está abierto, reutiliza el túnel existente.
 */
export async function ensureSshTunnelIfEnabled(): Promise<void> {
  if (String(process.env.SSH_TUNNEL_ENABLED || '').toLowerCase() !== 'true') return;

  const host = process.env.SSH_TUNNEL_HOST;
  const user = process.env.SSH_TUNNEL_USER || 'root';
  const password = process.env.SSH_TUNNEL_PASSWORD || '';
  const hostkey = process.env.SSH_TUNNEL_HOSTKEY || '';
  const localPort = Number(process.env.SSH_TUNNEL_LOCAL_PORT || 5433);
  const remotePort = Number(process.env.SSH_TUNNEL_REMOTE_PORT || 5433);

  if (!host) throw new Error('SSH_TUNNEL_HOST no configurado');

  if (await isPortOpen(localPort)) {
    console.log(`[SSH Tunnel] Puerto local ${localPort} ya disponible, reutilizando túnel.`);
    return;
  }

  const forward = `${localPort}:127.0.0.1:${remotePort}`;
  let cmd: string;
  let args: string[];
  if (process.platform === 'win32') {
    cmd = 'plink';
    args = ['-batch', '-N'];
    if (hostkey) args.push('-hostkey', hostkey);
    if (password) args.push('-pw', password);
    args.push('-L', forward, `${user}@${host}`);
  } else {
    cmd = 'ssh';
    args = ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-L', forward, `${user}@${host}`];
  }

  console.log(`[SSH Tunnel] Abriendo túnel 127.0.0.1:${localPort} -> ${host}:${remotePort} ...`);
  tunnelProcess = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  tunnelProcess.stderr?.on('data', (d) => { stderr += d.toString(); });
  tunnelProcess.on('exit', (code) => {
    console.warn(`[SSH Tunnel] Proceso terminado (código ${code}). ${stderr.trim()}`);
    tunnelProcess = null;
  });

  process.once('exit', cleanup);
  process.once('SIGINT', () => { cleanup(); process.exit(0); });
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });

  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (!tunnelProcess) throw new Error(`No se pudo abrir el túnel SSH: ${stderr.trim()}`);
    if (await isPortOpen(localPort)) {
      console.log('[SSH Tunnel] Túnel listo.');
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  cleanup();
  throw new Error(`Timeout esperando túnel SSH en puerto ${localPort}. ${stderr.trim()}`);
}
