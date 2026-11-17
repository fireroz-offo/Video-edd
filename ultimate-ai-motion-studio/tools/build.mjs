#!/usr/bin/env node
// One command from scene to finished MP4: check -> sound effects -> render -> mix (audio + subtitles) -> verify.
//
// Usage: node tools/build.mjs [options]
//   --format short|long   1080x1920 or 1920x1080        (default long)
//   --fps N               frame rate                     (default 30)
//   --scene FILE          scene html                     (default studio/scenes/demo-studio.html)
//   --name NAME           output name                    (default: scene file name)
//   --out-dir DIR         output folder                  (default studio/renders)
//   --start S --end E     render only that part of the scene (quick test)
//   --subs MODE           dom | burn | soft | none       (default dom)
//                           dom  = captions drawn by the scene itself (what the preview shows)
//                           burn = captions burned in by FFmpeg from the .srt file
//                           soft = captions as a switchable track inside the MP4
//                           none = no captions
//   --srt FILE            your own subtitle file (e.g. synced to your voiceover); implies --subs burn unless soft is chosen
//   --timing FILE         cue sheet                      (default studio/audio/timing.json)
//   --no-audio            skip the audio mix (silent video)
//   --allow-missing       skip configured audio files that are missing, with a warning
//   --png | --quality N | --crf N | --preset NAME | --gpu | --chrome PATH   passed to the renderer
// Output: <out-dir>/<name>-<format>.mp4 (final), plus <name>-<format>.srt, plus frames in <out-dir>/qc.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = join(ROOT, 'tools');
const VALUE = ['format', 'fps', 'scene', 'name', 'out-dir', 'start', 'end', 'subs', 'srt', 'timing', 'quality', 'crf', 'preset', 'chrome'];
const BOOL = ['no-audio', 'allow-missing', 'png', 'gpu', 'help'];
const die = (m) => { console.error('build: ' + m); process.exit(1); };
const o = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) die(`unexpected argument "${a}"`);
  const k = a.slice(2);
  if (VALUE.includes(k)) { if (i + 1 >= argv.length) die(`--${k} needs a value`); o[k] = argv[++i]; }
  else if (BOOL.includes(k)) o[k] = true;
  else die(`unknown option --${k}`);
}
if (o.help) die('see the header of tools/build.mjs for options');

const format = o.format ?? 'long', fps = o.fps ?? '30';
if (!['short', 'long'].includes(format)) die('--format must be short or long');
const scene = resolve(ROOT, o.scene ?? 'studio/scenes/demo-studio.html');
if (!existsSync(scene)) die(`scene not found: ${scene}`);
const name = (o.name ?? basename(scene).replace(/\.html?$/i, '')).replace(/[^\w.-]+/g, '-');
const outDir = resolve(ROOT, o['out-dir'] ?? 'studio/renders');
let subs = o.subs ?? (o.srt ? 'burn' : 'dom');
if (!['dom', 'burn', 'soft', 'none'].includes(subs)) die('--subs must be dom, burn, soft or none');
if (o.srt && subs === 'dom') subs = 'burn';
if (o.srt && !existsSync(resolve(o.srt))) die(`subtitle file not found: ${resolve(o.srt)}`);

const base = join(outDir, `${name}-${format}`);
const silent = base + '.video.mp4', final = base + '.mp4', srt = base + '.srt';
const start = o.start ? Number(o.start) : 0;

function step(title, cmd, args) {
  console.log(`\n=== ${title}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT });
  if (r.error) die(`${title}: ${r.error.message}`);
  if (r.status !== 0) die(`${title} failed (exit ${r.status}). Nothing after this step was run.`);
}

// 1. environment
step('1/5 environment check', 'bash', [join(TOOLS, 'check-env.sh'), ...(subs === 'burn' ? ['--need-libass'] : [])]);

// 2. sound effects (the mixer also generates any missing ones; this makes failures show up early)
if (!o['no-audio']) step('2/5 sound effects', 'node', [join(TOOLS, 'make-sfx.mjs')]); else console.log('\n=== 2/5 sound effects: skipped (--no-audio)');

// 3. render (silent video + .srt)
const r = ['--format', format, '--fps', fps, '--subs', subs === 'dom' ? 'dom' : 'none'];
for (const k of ['start', 'end', 'quality', 'crf', 'preset', 'chrome']) if (o[k] !== undefined) r.push('--' + k, o[k]);
for (const k of ['png', 'gpu']) if (o[k]) r.push('--' + k);
step('3/5 render frames', 'node', [join(TOOLS, 'render.mjs'), scene, silent, ...r]);

// 4. audio + subtitles
const mixArgs = [silent, final, '--subs', subs === 'burn' || subs === 'soft' ? subs : 'none'];
if (o.start) mixArgs.push('--start', String(start));
if (o.srt) mixArgs.push('--srt', resolve(o.srt)); else if (subs === 'burn' || subs === 'soft') mixArgs.push('--srt', srt);
if (o.timing) mixArgs.push('--timing', resolve(o.timing));
if (o['no-audio']) mixArgs.push('--no-audio');
if (o['allow-missing']) mixArgs.push('--allow-missing');
step('4/5 audio + subtitles', 'node', [join(TOOLS, 'mix.mjs'), ...mixArgs]);
rmSync(silent, { force: true });

// 5. verify
const vArgs = [final, '--format', format, '--fps', fps, '--frames', join(outDir, 'qc'), '--audio', o['no-audio'] ? 'none' : 'required'];
// Expected length is only known for sure when --end is given, or for the 30 s demo scene rendered in full.
if (o.end !== undefined) vArgs.push('--duration', String(Number(o.end) - start));
else if (!o.start && basename(scene) === 'demo-studio.html') vArgs.push('--duration', '30');
step('5/5 verify', 'node', [join(TOOLS, 'verify.mjs'), ...vArgs]);

console.log(`\nbuild: done -> ${final}`);
