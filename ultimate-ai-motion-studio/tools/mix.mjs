#!/usr/bin/env node
// Adds audio (voiceover, music, sound effects) and optional subtitles to a rendered silent video.
//
// Usage: node tools/mix.mjs <video.mp4> <out.mp4> [options]
//   --timing FILE        cue sheet                                   (default studio/audio/timing.json)
//   --start S            the video is a partial render beginning at scene second S (shifts cues, trims voice/music)
//   --subs MODE          none | burn | soft                           (default none: captions are already in the picture)
//   --srt FILE           subtitle file for burn/soft                  (default <video>.srt next to the input video)
//   --no-audio           only handle subtitles; skip the audio mix
//   --allow-missing      warn and skip configured audio files that do not exist (default: stop with an error)
//   --sfx-dir DIR        where generated sound effects live           (default studio/audio/generated)
//
// Audio chain: voice -> loudnorm (voice_lufs); music -> loudnorm (music_lufs) -> ducked under the voice;
// sound effects -> per-cue gain + delay; sum -> loudnorm to master_lufs (only when voice or music is present) -> limiter.
// The video stream is copied untouched unless subtitles are burned in.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSfx, PRESETS } from './make-sfx.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLAGS = { timing: 1, start: 1, subs: 1, srt: 1, 'sfx-dir': 1, 'no-audio': 0, 'allow-missing': 0, help: 0 };
const fail = (m) => { console.error('mix: ' + m); process.exit(1); };
const usage = () => { console.error('usage: node tools/mix.mjs <video.mp4> <out.mp4> [--timing FILE] [--start S] [--subs none|burn|soft] [--srt FILE] [--no-audio] [--allow-missing] [--sfx-dir DIR]'); process.exit(1); };

const pos = [], o = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { pos.push(a); continue; }
  const k = a.slice(2);
  if (!(k in FLAGS)) fail(`unknown option --${k}`);
  if (FLAGS[k]) { if (i + 1 >= argv.length) fail(`--${k} needs a value`); o[k] = argv[++i]; } else o[k] = true;
}
if (o.help || pos.length !== 2) usage();

const inVideo = resolve(pos[0]), outVideo = resolve(pos[1]);
if (!existsSync(inVideo)) fail(`video not found: ${inVideo}`);
if (inVideo === outVideo) fail('output must be a different file from the input');
const subsMode = o.subs ?? 'none';
if (!['none', 'burn', 'soft'].includes(subsMode)) fail(`--subs must be none, burn or soft (got "${subsMode}")`);
const start = o.start === undefined ? 0 : Number(o.start);
if (!Number.isFinite(start) || start < 0) fail(`--start must be a number >= 0 (got "${o.start}")`);
const timingPath = resolve(o.timing ?? join(ROOT, 'studio/audio/timing.json'));
const sfxDir = resolve(o['sfx-dir'] ?? join(ROOT, 'studio/audio/generated'));
const allowMissing = !!o['allow-missing'];

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]);
  if (r.error) fail(r.error.code === 'ENOENT' ? 'ffprobe not found. Install FFmpeg first.' : r.error.message);
  if (r.status !== 0) fail(`cannot read ${file}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}
const vinfo = probe(inVideo);
const vstream = vinfo.streams.find((s) => s.codec_type === 'video');
if (!vstream) fail('input has no video stream');
const duration = Number(vinfo.format.duration);
const W = vstream.width, H = vstream.height;

// ---------- audio plan ----------
const warnings = [];
const missing = (what, path) => {
  const msg = `${what} not found: ${path}`;
  if (allowMissing) { warnings.push(msg + ' (skipped)'); return; }
  fail(msg + '\n  Add the file, set it to null in studio/audio/timing.json, or run with --allow-missing.');
};
const sources = [];        // { file, kind: 'voice'|'music'|'sfx', gain_db, t }
let cfg = { mix: {}, cues: [] };
let hasVoice = false, hasMusic = false;

if (!o['no-audio']) {
  if (!existsSync(timingPath)) fail(`cue sheet not found: ${timingPath}`);
  try { cfg = JSON.parse(readFileSync(timingPath, 'utf8')); } catch (e) { fail(`${timingPath} is not valid JSON: ${e.message}`); }
  const rel = (p) => resolve(ROOT, p);
  for (const [key, kind] of [['voiceover', 'voice'], ['music', 'music']]) {
    const p = cfg[key];
    if (p === null || p === undefined || p === '') continue;
    if (typeof p !== 'string') fail(`"${key}" in timing.json must be a file path or null`);
    if (!existsSync(rel(p))) { missing(key, rel(p)); continue; }
    sources.push({ file: rel(p), kind, gain_db: 0, t: 0 });
    if (kind === 'voice') hasVoice = true; else hasMusic = true;
  }
  const needed = new Set();
  for (const [i, c] of (cfg.cues ?? []).entries()) {
    if (typeof c.t !== 'number' || !Number.isFinite(c.t) || c.t < 0) fail(`cue #${i + 1}: "t" must be a number >= 0`);
    if (c.gain_db !== undefined && !Number.isFinite(c.gain_db)) fail(`cue #${i + 1}: "gain_db" must be a number`);
    if (c.type && c.type !== 'sfx') continue;     // voice/music cues are handled by the top-level keys
    if (c.preset) { if (!PRESETS[c.preset]) fail(`cue #${i + 1}: unknown preset "${c.preset}" (available: ${Object.keys(PRESETS).join(', ')})`); needed.add(c.preset); }
    else if (!c.file) fail(`cue #${i + 1}: needs "preset" or "file"`);
  }
  if (needed.size) makeSfx(sfxDir, { names: [...needed] });
  for (const [i, c] of (cfg.cues ?? []).entries()) {
    if (c.type && c.type !== 'sfx') continue;
    const t = c.t - start;
    if (t < 0) continue;                           // cue happened before the rendered range
    if (t >= duration) continue;                   // cue is after the end of this video
    const file = c.preset ? join(sfxDir, c.preset + '.wav') : rel(c.file);
    if (!existsSync(file)) { missing(`cue #${i + 1} file`, file); continue; }
    sources.push({ file, kind: 'sfx', gain_db: c.gain_db ?? 0, t });
  }
}
const m = { voice_lufs: -14, music_lufs: -18, duck_db: -12, master_lufs: -14, true_peak_db: -1.5, loop_music: true, music_fade_out_s: 1.5, ...cfg.mix };
const hasAudio = sources.length > 0;

// ---------- subtitles ----------
let srtFile = null;
if (subsMode !== 'none') {
  srtFile = resolve(o.srt ?? inVideo.replace(/\.mp4$/i, '.srt'));
  if (!existsSync(srtFile)) fail(`subtitle file not found: ${srtFile}\n  Render with tools/render.mjs (it writes <video>.srt) or pass --srt your-file.srt`);
  if (subsMode === 'burn') {
    const f = run('ffmpeg', ['-hide_banner', '-filters']);
    if (!/\bsubtitles\b/.test(f.stdout ?? '')) fail('this FFmpeg has no "subtitles" filter (libass). Use --subs soft, or install an FFmpeg build with libass.');
  }
}
if (!hasAudio && subsMode === 'none') {
  for (const w of warnings) console.error('mix: warning: ' + w);
  copyFileSync(inVideo, outVideo + '.tmp.mp4'); renameSync(outVideo + '.tmp.mp4', outVideo);
  console.log('mix: nothing to add (no audio sources, no subtitles); copied video unchanged -> ' + outVideo);
  process.exit(0);
}

// ---------- ffmpeg command ----------
const work = mkdtempSync(join(tmpdir(), 'mix-'));
const cleanup = () => rmSync(work, { recursive: true, force: true });
process.on('exit', cleanup);
mkdirSync(dirname(outVideo), { recursive: true });
const tmpOut = outVideo + '.partial.mp4';

const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', inVideo];
const fc = [];
const AF = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
const labels = [];
let inputIndex = 1;
const dbl = (x) => Number(x).toFixed(2);
let voiceLabel = null;

if (hasAudio) {
  const voice = sources.find((s) => s.kind === 'voice');
  const music = sources.find((s) => s.kind === 'music');
  if (voice) {
    if (start > 0) args.push('-ss', String(start));
    args.push('-i', voice.file);
    fc.push(`[${inputIndex}:a]${AF},loudnorm=I=${m.voice_lufs}:TP=${m.true_peak_db}:LRA=9,aresample=48000,${AF},asplit=2[vo][vosc]`);
    labels.push('[vo]'); voiceLabel = '[vosc]'; inputIndex++;
  }
  if (music) {
    if (start > 0) args.push('-ss', String(start));
    if (m.loop_music) args.push('-stream_loop', '-1');
    args.push('-i', music.file);
    const fadeStart = Math.max(0, duration - m.music_fade_out_s);
    let chain = `[${inputIndex}:a]${AF},atrim=0:${dbl(duration)},asetpts=PTS-STARTPTS,loudnorm=I=${m.music_lufs}:TP=${m.true_peak_db}:LRA=9,aresample=48000,${AF},afade=t=out:st=${dbl(fadeStart)}:d=${dbl(m.music_fade_out_s)}`;
    if (voiceLabel) {
      // Duck the music under the voice: a compressor on the music that listens to the voice.
      // ratio is derived from duck_db so a louder voice gives roughly that much reduction.
      const ratio = Math.min(20, Math.max(2, Math.round(Math.abs(m.duck_db) * 1.5)));
      chain += `[mus];[mus]${voiceLabel}sidechaincompress=threshold=0.01:ratio=${ratio}:attack=20:release=500:makeup=1[musd]`;
      labels.push('[musd]');
    } else { chain += '[musd]'; labels.push('[musd]'); }
    fc.push(chain); inputIndex++;
  }
  sources.filter((s) => s.kind === 'sfx').forEach((s, k) => {
    args.push('-i', s.file);
    const ms = Math.round(s.t * 1000);
    fc.push(`[${inputIndex}:a]${AF},volume=${dbl(s.gain_db)}dB,adelay=${ms}|${ms}[sx${k}]`);
    labels.push(`[sx${k}]`); inputIndex++;
  });
  const mixed = labels.length === 1 ? `${labels[0]}anull` : `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest`;
  const master = (hasVoice || hasMusic) ? `,loudnorm=I=${m.master_lufs}:TP=${m.true_peak_db}:LRA=11,aresample=48000` : '';
  const limit = Math.pow(10, m.true_peak_db / 20).toFixed(4);
  fc.push(`${mixed}${master},${AF},alimiter=limit=${limit}:level=disabled,apad,atrim=0:${dbl(duration)},asetpts=PTS-STARTPTS[aout]`);
}

// video / subtitles
let vmap = '0:v:0', vcodec = ['-c:v', 'copy'];
if (subsMode === 'burn') {
  copyFileSync(srtFile, join(work, 'subs.srt'));
  // libass scales font size by video height (PlayResY 288): convert a size of ~4.6% of the shorter side.
  const px = 0.046 * Math.min(W, H), size = (px * 288 / H).toFixed(1), marginV = Math.round((H >= W ? 0.12 : 0.09) * 288);
  fc.push(`[0:v]subtitles=subs.srt:force_style='FontName=DejaVu Sans,FontSize=${size},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=${marginV}'[vout]`);
  vmap = '[vout]'; vcodec = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p'];
}
if (subsMode === 'soft') args.push('-i', srtFile);
if (fc.length) args.push('-filter_complex', fc.join(';'));
args.push('-map', vmap);
if (hasAudio) args.push('-map', '[aout]');
if (subsMode === 'soft') args.push('-map', `${inputIndex}:s:0`);
args.push(...vcodec);
if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2');
if (subsMode === 'soft') args.push('-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng');
args.push('-t', dbl(duration), '-movflags', '+faststart', '-f', 'mp4', tmpOut);

const r = run('ffmpeg', args, { cwd: work });
if (r.error) fail(r.error.code === 'ENOENT' ? 'ffmpeg not found. Install FFmpeg first.' : r.error.message);
if (r.status !== 0) { rmSync(tmpOut, { force: true }); fail('ffmpeg failed:\n' + r.stderr.trim()); }
renameSync(tmpOut, outVideo);

for (const w of warnings) console.error('mix: warning: ' + w);
const parts = [];
if (hasVoice) parts.push('voiceover');
if (hasMusic) parts.push(hasVoice ? 'music (ducked under voice)' : 'music');
const nsfx = sources.filter((s) => s.kind === 'sfx').length; if (nsfx) parts.push(`${nsfx} sound effect${nsfx > 1 ? 's' : ''}`);
console.log(`mix: wrote ${outVideo}\n  audio: ${parts.join(', ') || 'none'}${hasVoice || hasMusic ? '' : ' (no voiceover/music configured)'}\n  subtitles: ${subsMode}`);
