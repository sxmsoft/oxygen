// Tiny Chrome DevTools Protocol helper (Node >= 22, built-in WebSocket).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Launches Helium headless at lowest CPU/IO priority with an isolated profile. */
export async function launchBrowser({ binary, profileDir, extensions = [], extraArgs = [], env = {} }) {
  const args = [
    '-n', '19', 'ionice', '-c3', binary,
    '--headless=new',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--window-size=1280,860',
    ...(extensions.length ? [`--load-extension=${extensions.join(',')}`] : []),
    ...extraArgs,
    'about:blank',
  ];
  const portFile = join(profileDir, 'DevToolsActivePort');
  rmSync(portFile, { force: true }); // stale file from a previous run
  const proc = spawn('nice', args, { stdio: 'ignore', detached: true, env: { ...process.env, ...env } });
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error('browser did not start (no DevToolsActivePort)');
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const cdp = await CDP.connect(`ws://127.0.0.1:${port}${path}`);
  return { proc, cdp, pid: proc.pid };
}

/** Closes only the browser we started (its own process group). */
export async function closeBrowser(b) {
  try {
    await Promise.race([b.cdp.send('Browser.close'), sleep(3000)]);
  } catch {}
  b.cdp.close();
  for (let i = 0; i < 50; i++) {
    try { process.kill(b.pid, 0); } catch { return; }
    await sleep(100);
  }
  try { process.kill(-b.pid, 'SIGKILL'); } catch {}
}

export class CDP {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CDP(ws));
      ws.onerror = (e) => reject(new Error('CDP connect failed: ' + e.message));
    });
  }
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() { try { this.ws.close(); } catch {} }

  async targets() {
    return (await this.send('Target.getTargets')).targetInfos;
  }
  async waitForTarget(pred, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const t = (await this.targets()).find(pred);
      if (t) return t;
      await sleep(150);
    }
    throw new Error('target not found');
  }
  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return sessionId;
  }
  async evaluate(sessionId, expression) {
    const r = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId
    );
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  }
  async openPage(url) {
    const { targetId } = await this.send('Target.createTarget', { url });
    const sessionId = await this.attach(targetId);
    await this.send('Page.enable', {}, sessionId);
    return { targetId, sessionId };
  }
  async waitFor(sessionId, expression, timeoutMs = 8000) {
    const end = Date.now() + timeoutMs;
    let last;
    while (Date.now() < end) {
      try {
        last = await this.evaluate(sessionId, expression);
        if (last) return last;
      } catch (e) { last = e.message; }
      await sleep(150);
    }
    throw new Error(`timeout waiting for: ${expression} (last=${JSON.stringify(last)})`);
  }
  async screenshot(sessionId) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    return Buffer.from(data, 'base64');
  }
}

/**
 * Copies an unpacked extension to a temp dir without the personal Helium
 * shortcut import, so tests never see (or screenshot) the user's own links.
 * The manifest key keeps the extension id identical.
 */
export function stageExtension(srcDir) {
  const dir = join(mkdtempSync(join(tmpdir(), 'oxygen-e2e-ext-')), 'extension');
  cpSync(srcDir, dir, { recursive: true });
  rmSync(join(dir, 'imported-shortcuts.json'), { force: true });
  return dir;
}

export { sleep };
