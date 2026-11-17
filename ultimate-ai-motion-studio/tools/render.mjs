#!/usr/bin/env node
// Deterministic HTML scene -> MP4 renderer. Produces VIDEO ONLY; tools/mix.mjs adds audio and subtitles.
//
// Usage: node tools/render.mjs <scene.html> <out.mp4> [options]
//   --format short|long   1080x1920 or 1920x1080                     (default long)
//   --fps N               frames per second, 1-120                   (default 30)
//   --start S --end E     render only scene seconds S..E             (default 0..DURATION)
//   --png                 lossless PNG frames (slower, cleaner)      (default JPEG)
//   --quality N           JPEG quality 1-100                         (default 95)
//   --crf N               x264 quality 0-51, lower = better          (default 18)
//   --preset NAME         x264 preset, e.g. veryfast, medium, slow   (default veryfast)
//   --subs dom|none       draw the scene's built-in subtitles into the picture (default dom)
//   --gpu                 use this machine's GPU instead of software WebGL (faster, less reproducible)
//   --chrome PATH         use this Chrome/Chromium executable instead of Puppeteer's own
//   --timeout MS          how long to wait for the scene to become ready (default 60000)
//
// Needs: node 18+, puppeteer, ffmpeg.
// Scene contract: window.DURATION, window.setTime(t), window.READY === true once the first frame is drawn.
// Optional: window.SUBTITLES = [{start,end,text}] is written to <out>.srt next to the video.
// The scene is told it is being rendered (window.__RENDER__) so it hides preview UI and stops its own playback loop.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FLAGS = { format: 1, fps: 1, start: 1, end: 1, quality: 1, crf: 1, preset: 1, subs: 1, chrome: 1, timeout: 1, png: 0, gpu: 0, help: 0 };
const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];

function fail(msg) { console.error('render: ' + msg); process.exit(1); }
function usage() {
  console.error('usage: node tools/render.mjs <scene.html> <out.mp4> [--format short|long] [--fps N] [--start S] [--end E]\n' +
    '                                [--png] [--quality N] [--crf N] [--preset NAME] [--subs dom|none] [--gpu] [--chrome PATH] [--timeout MS]');
  process.exit(1);
}

function parseArgs(argv) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (!(k in FLAGS)) fail(`unknown option --${k}`);
    if (FLAGS[k]) { if (i + 1 >= argv.length) fail(`--${k} needs a value`); o[k] = argv[++i]; } else o[k] = true;
  }
  return { pos, o };
}

const { pos, o } = parseArgs(process.argv.slice(2));
if (o.help || pos.length !== 2) usage();
const num = (k, d, min, max) => {
  if (o[k] === undefined) return d;
  const v = Number(o[k]);
  if (!Number.isFinite(v) || v < min || v > max) fail(`--${k} must be a number from ${min} to ${max} (got "${o[k]}")`);
  return v;
};
const fmt = o.format ?? 'long';
if (fmt !== 'short' && fmt !== 'long') fail(`--format must be short or long (got "${fmt}")`);
const subsMode = o.subs ?? 'dom';
if (subsMode !== 'dom' && subsMode !== 'none') fail(`--subs must be dom or none (got "${subsMode}")`);
const preset = o.preset ?? 'veryfast';
if (!PRESETS.includes(preset)) fail(`--preset must be one of ${PRESETS.join(', ')}`);
const fps = num('fps', 30, 1, 120), quality = num('quality', 95, 1, 100), crf = num('crf', 18, 0, 51);
const timeoutMs = num('timeout', 60000, 1000, 3600000);
const [W, H] = fmt === 'short' ? [1080, 1920] : [1920, 1080];
const scenePath = resolve(pos[0]), outPath = resolve(pos[1]);
if (!existsSync(scenePath)) fail(`scene not found: ${scenePath}`);
if (extname(outPath).toLowerCase() !== '.mp4') fail('output file must end in .mp4');
mkdirSync(dirname(outPath), { recursive: true });
const partial = outPath + '.partial';
const srtPath = outPath.replace(/\.mp4$/i, '.srt');

let puppeteer;
try { puppeteer = (await import('puppeteer')).default; }
catch { fail('puppeteer is not installed. Run "npm install" in the project folder first.'); }

const pad = (n, w = 2) => String(n).padStart(w, '0');
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms % 3600000 / 60000))}:${pad(Math.floor(ms % 60000 / 1000))},${pad(ms % 1000, 3)}`;
};

let browser = null, ff = null, ffExit = null, ffErr = '';
const cleanup = () => {
  try { ff && ff.exitCode === null && ff.kill('SIGKILL'); } catch {}
  try { rmSync(partial, { force: true }); } catch {}
};
process.on('SIGINT', () => { cleanup(); try { browser?.process()?.kill('SIGKILL'); } catch {} process.exit(130); });

async function main() {
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  // Software WebGL by default: slower but identical on every machine. --gpu opts out.
  if (!o.gpu) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  try { browser = await puppeteer.launch({ headless: true, args, executablePath: o.chrome || undefined }); }
  catch (e) { throw new Error(`could not start Chrome: ${e.message}\n  Install it with "npx puppeteer browsers install chrome" or pass --chrome /path/to/chrome`); }

  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((subs) => { window.__RENDER__ = true; window.__SUBS__ = subs; }, subsMode);

  const problems = [], warnings = new Set();
  page.on('pageerror', (e) => problems.push('page error: ' + (e?.message ?? e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) warnings.add(t); else problems.push('console error: ' + t);
  });
  page.on('requestfailed', (r) => warnings.add(`request failed: ${r.url()} (${r.failure()?.errorText ?? 'unknown'})`));
  const check = () => {
    if (!problems.length) return;
    const hint = problems.some((p) => /webgl/i.test(p)) ? '\n  Hint: WebGL failed. Try --gpu, or --chrome with a Chrome that supports WebGL.' : '';
    throw new Error('the scene reported errors:\n  ' + [...new Set(problems)].slice(0, 5).join('\n  ') + hint);
  };

  await page.goto(pathToFileURL(scenePath).href, { waitUntil: 'load', timeout: timeoutMs });
  try { await page.waitForFunction(() => window.READY === true, { timeout: timeoutMs, polling: 100 }); }
  catch { check(); throw new Error(`the scene did not signal window.READY within ${timeoutMs / 1000}s (is Three.js reachable? is the scene script crashing?)`); }
  check();

  const info = await page.evaluate(() => ({
    dur: window.DURATION, hasSetTime: typeof window.setTime === 'function',
    subs: Array.isArray(window.SUBTITLES) ? window.SUBTITLES : [],
  }));
  if (!Number.isFinite(info.dur) || info.dur <= 0) throw new Error('scene must define window.DURATION (seconds, > 0)');
  if (!info.hasSetTime) throw new Error('scene must define window.setTime(seconds)');
  const start = num('start', 0, 0, info.dur), end = num('end', info.dur, 0, info.dur);
  if (end <= start) fail(`--end (${end}) must be greater than --start (${start})`);
  const n = Math.max(1, Math.round((end - start) * fps));
  if (warnings.size) console.error('note: ' + [...warnings].slice(0, 3).join(' | ') + (warnings.size > 3 ? ' ...' : ''));

  ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', o.png ? 'png' : 'mjpeg', '-i', 'pipe:0',
    '-an', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-f', 'mp4', partial], { stdio: ['pipe', 'ignore', 'pipe'] });
  ff.stderr.on('data', (d) => { ffErr += d; });
  ff.stdin.on('error', () => {});               // a dead ffmpeg is reported through its exit code below
  const ffClosed = new Promise((res) => {
    ff.on('error', (e) => { ffExit = { code: -1, err: e.code === 'ENOENT' ? 'ffmpeg not found. Install FFmpeg first.' : e.message }; res(ffExit); });
    ff.on('close', (code) => { ffExit ??= { code }; res(ffExit); });
  });

  const shot = o.png ? { type: 'png' } : { type: 'jpeg', quality };
  Object.assign(shot, { captureBeyondViewport: false, optimizeForSpeed: true });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    if (ffExit) throw new Error('ffmpeg stopped early: ' + (ffExit.err || ffErr.trim() || `exit ${ffExit.code}`));
    await page.evaluate(async (t) => {
      window.setTime(t);   // draws exactly this moment; nothing else animates the scene
      await Promise.race([new Promise((r) => requestAnimationFrame(() => r())), new Promise((r) => setTimeout(r, 1000))]);
    }, start + i / fps);
    check();
    const buf = await page.screenshot(shot);
    if (!ff.stdin.write(buf)) await Promise.race([once(ff.stdin, 'drain'), ffClosed]);
    if (i % 30 === 29 || i === n - 1) {
      const done = i + 1, eta = Math.round((Date.now() - t0) / done * (n - done) / 1000);
      const line = `render: frame ${done}/${n} (${Math.round(done / n * 100)}%)` + (done < n ? `, about ${eta}s left` : '');
      if (process.stderr.isTTY) process.stderr.write('\r' + line + '   '); else if (done === n || done % 150 === 0) console.error(line);
    }
  }
  if (process.stderr.isTTY) process.stderr.write('\n');
  ff.stdin.end();
  const r = await ffClosed;
  if (r.code !== 0) throw new Error('ffmpeg failed: ' + (r.err || ffErr.trim() || `exit ${r.code}`));

  rmSync(outPath, { force: true });
  renameSync(partial, outPath);

  // Sidecar subtitles, shifted to the rendered range, from the scene's own caption list.
  const cues = info.subs.map((c) => ({ s: Math.max(start, c.start) - start, e: Math.min(end, c.end) - start, text: String(c.text) })).filter((c) => c.e > c.s);
  if (cues.length) writeFileSync(srtPath, cues.map((c, k) => `${k + 1}\n${srtTime(c.s)} --> ${srtTime(c.e)}\n${c.text}\n`).join('\n'));

  console.log(`done ${outPath} ${W}x${H}@${fps} ${n} frames (${start}s-${end}s)${cues.length ? ' + ' + srtPath : ''} in ${Math.round((Date.now() - t0) / 1000)}s`);
}

try { await main(); }
catch (e) { console.error('render failed: ' + e.message); process.exitCode = 1; cleanup(); }
finally { try { await browser?.close(); } catch {} }
