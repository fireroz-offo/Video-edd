#!/usr/bin/env node
// Checks a finished video with ffprobe/ffmpeg and saves start/middle/end frames for visual inspection.
//
// Usage: node tools/verify.mjs <video.mp4> [options]
//   --format short|long   expected size 1080x1920 / 1920x1080 (default: not checked)
//   --fps N               expected frame rate                  (default: not checked)
//   --duration S          expected duration in seconds, +/-0.1 s (default: not checked)
//   --audio MODE          required | none | auto               (default auto: reported, not enforced)
//   --frames DIR          where to save frames                 (default studio/renders/qc)
// Exit code 0 = every enforced check passed, 1 = a check failed or the file is unreadable.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLAGS = { format: 1, fps: 1, duration: 1, audio: 1, frames: 1, help: 0 };
const die = (m) => { console.error('verify: ' + m); process.exit(1); };
const pos = [], o = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { pos.push(a); continue; }
  const k = a.slice(2);
  if (!(k in FLAGS)) die(`unknown option --${k}`);
  if (FLAGS[k]) { if (i + 1 >= argv.length) die(`--${k} needs a value`); o[k] = argv[++i]; } else o[k] = true;
}
if (o.help || pos.length !== 1) die('usage: node tools/verify.mjs <video.mp4> [--format short|long] [--fps N] [--duration S] [--audio required|none|auto] [--frames DIR]');
const file = resolve(pos[0]);
if (!existsSync(file)) die(`file not found: ${file}`);
const audioMode = o.audio ?? 'auto';
if (!['required', 'none', 'auto'].includes(audioMode)) die('--audio must be required, none or auto');
if (o.format && !['short', 'long'].includes(o.format)) die('--format must be short or long');

const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
const p = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
if (p.error) die(p.error.code === 'ENOENT' ? 'ffprobe not found. Install FFmpeg first.' : p.error.message);
if (p.status !== 0) die(`not a readable media file: ${p.stderr.trim()}`);
const info = JSON.parse(p.stdout);
const v = info.streams.find((s) => s.codec_type === 'video');
const a = info.streams.find((s) => s.codec_type === 'audio');
const subs = info.streams.filter((s) => s.codec_type === 'subtitle');
if (!v) die('no video stream');

const [num, den] = String(v.avg_frame_rate || v.r_frame_rate).split('/').map(Number);
const fps = den ? num / den : num;
const dur = Number(info.format.duration);
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

check('video codec h264 / yuv420p', v.codec_name === 'h264' && v.pix_fmt === 'yuv420p', `${v.codec_name} ${v.pix_fmt}`);
if (o.format) {
  const [W, H] = o.format === 'short' ? [1080, 1920] : [1920, 1080];
  check(`resolution ${W}x${H}`, v.width === W && v.height === H, `${v.width}x${v.height}`);
}
if (o.fps) check(`frame rate ${o.fps}`, Math.abs(fps - Number(o.fps)) < 0.01, fps.toFixed(3));
if (o.duration) check(`duration ${o.duration}s`, Math.abs(dur - Number(o.duration)) <= 0.1, dur.toFixed(3) + 's');
if (audioMode === 'required') check('audio stream present', !!a, a ? `${a.codec_name} ${a.sample_rate} Hz ${a.channels}ch` : 'none');
if (audioMode === 'none') check('no audio stream', !a, a ? 'audio present' : 'none');
if (a && Math.abs(Number(a.duration) - dur) > 0.15) check('audio length matches video', false, `audio ${Number(a.duration).toFixed(2)}s vs video ${dur.toFixed(2)}s`);

// loudness (EBU R128) and true peak
let loud = null;
if (a) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const sum = (r.stderr || '').split('Summary:')[1] || '';
  const g = (re) => { const m = sum.match(re); return m ? Number(m[1]) : null; };
  loud = { lufs: g(/I:\s+(-?[\d.]+|-inf)\s+LUFS/), lra: g(/LRA:\s+(-?[\d.]+)\s+LU/), peak: g(/Peak:\s+(-?[\d.]+)\s+dBFS/) };
  if (loud.peak !== null) check('true peak at or below -1 dBFS', loud.peak <= -1, `${loud.peak} dBFS`);
}

// frames to look at
const outDir = resolve(o.frames ?? join(ROOT, 'studio/renders/qc'));
mkdirSync(outDir, { recursive: true });
const stem = basename(file).replace(/\.[^.]+$/, '');
const saved = [];
// "end" seeks relative to the end of the file; seeking to the exact last timestamp can return no frame.
for (const [label, seek] of [['start', ['-ss', '0']], ['middle', ['-ss', (dur / 2).toFixed(3)]], ['end', ['-sseof', '-0.2']]]) {
  const out = join(outDir, `${stem}-${label}.png`);
  const r = run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...seek, '-i', file, '-frames:v', '1', '-update', '1', out]);
  if (r.status === 0 && existsSync(out)) saved.push(out); else check(`frame at ${label}`, false, 'could not extract');
}

console.log(`file      ${file} (${(statSync(file).size / 1048576).toFixed(2)} MB)`);
console.log(`video     ${v.codec_name} ${v.width}x${v.height} @ ${fps.toFixed(3)} fps, ${dur.toFixed(3)} s`);
console.log(`audio     ${a ? `${a.codec_name} ${a.sample_rate} Hz ${a.channels}ch` : 'none'}`);
if (loud) console.log(`loudness  ${loud.lufs} LUFS integrated, LRA ${loud.lra} LU, true peak ${loud.peak} dBFS`);
console.log(`subtitles ${subs.length ? subs.map((s) => s.codec_name).join(', ') + ' (soft track)' : 'no soft track (captions, if any, are burned into the picture)'}`);
console.log('frames    ' + (saved.length ? '\n  ' + saved.join('\n  ') : 'none'));
console.log('\nchecks:');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  [${r.detail}]`);
if (!results.length) console.log('  (no expectations given; pass --format/--fps/--duration/--audio to enforce)');
const bad = results.filter((r) => !r.ok).length;
console.log(bad ? `\nverify: ${bad} check(s) FAILED` : '\nverify: all enforced checks passed (look at the saved frames to judge the picture itself)');
process.exit(bad ? 1 : 0);
