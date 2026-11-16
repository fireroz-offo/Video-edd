// Usage: node tools/render.mjs <scene.html> <out.mp4> [--format short|long] [--fps 30|60]
// Needs: node, puppeteer, ffmpeg. Scene must expose window.setTime(t) and window.DURATION.
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const a = process.argv.slice(2);
const [scene, out] = a;
const opt = (k, d) => { const i = a.indexOf('--' + k); return i > -1 ? a[i + 1] : d; };
const fmt = opt('format', 'long'), fps = +opt('fps', 30);
const [W, H] = fmt === 'short' ? [1080, 1920] : [1920, 1080];
if (!scene || !out) { console.error('usage: render.mjs scene.html out.mp4'); process.exit(1); }
const browser = await puppeteer.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
page.on('console', m => m.type() === 'error' && console.error('[page]', m.text()));
await page.goto('file://' + resolve(scene), { waitUntil: 'networkidle0' });
const dur = await page.evaluate(() => window.DURATION);
const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const n = Math.round(dur * fps);
for (let i = 0; i < n; i++) {
  await page.evaluate(t => window.setTime(t), i / fps);
  ff.stdin.write(await page.screenshot({ type: 'jpeg', quality: 92 }));
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
await browser.close();
console.log('done', out, `${W}x${H}@${fps}`, n, 'frames');
