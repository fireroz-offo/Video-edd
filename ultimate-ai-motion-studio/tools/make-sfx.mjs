#!/usr/bin/env node
// Synthesises the built-in sound effects with FFmpeg only (no downloads, no copyrighted material).
// Usage: node tools/make-sfx.mjs [--out studio/audio/generated] [--force]
// Output: whoosh.wav, impact.wav, riser.wav, tick.wav (48 kHz, stereo, 16-bit). Generation is seeded, so output is repeatable.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SFX_DIR = join(ROOT, 'studio', 'audio', 'generated');
const FMT = 'aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo';

// name -> ffmpeg arguments that produce the sound (lavfi source + filters)
export const PRESETS = {
  // filtered noise swell with a rising then falling brightness: camera travel
  whoosh: ['-f', 'lavfi', '-i', 'anoisesrc=d=1.5:c=pink:r=48000:a=0.9:seed=11',
    '-af', `highpass=f=250,lowpass=f=4200,tremolo=f=3:d=0.25,afade=t=in:st=0:d=0.75:curve=qsin,afade=t=out:st=0.75:d=0.75:curve=qsin,stereotools=mlev=0.9:slev=1.6,volume=10dB,alimiter=limit=0.9,${FMT}`],
  // low sine thump with a short noise transient: text/title landing
  impact: ['-f', 'lavfi', '-i', "aevalsrc='0.9*sin(2*PI*(48*t+30*(1-exp(-9*t))/9))*exp(-5*t)+0.35*(random(0)*2-1)*exp(-45*t)':d=1.3:s=48000",
    '-af', `lowpass=f=2500,alimiter=limit=0.9,${FMT}`],
  // rising tone + noise that builds to the next beat
  riser: ['-f', 'lavfi', '-i', "aevalsrc='(0.55*sin(2*PI*(180*t+110*t*t))+0.25*(random(1)*2-1))*pow(t/2.5,2)':d=2.5:s=48000",
    '-af', `highpass=f=120,lowpass=f=6000,afade=t=out:st=2.35:d=0.15,${FMT}`],
  // short data tick
  tick: ['-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*1800*t)*exp(-90*t)':d=0.12:s=48000",
    '-af', FMT],
};

export function makeSfx(outDir = DEFAULT_SFX_DIR, { force = false, names = Object.keys(PRESETS) } = {}) {
  mkdirSync(outDir, { recursive: true });
  const made = [];
  for (const name of names) {
    const args = PRESETS[name];
    if (!args) throw new Error(`unknown sound preset "${name}" (available: ${Object.keys(PRESETS).join(', ')})`);
    const file = join(outDir, name + '.wav');
    if (existsSync(file) && !force) { made.push(file); continue; }
    const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, '-c:a', 'pcm_s16le', file], { encoding: 'utf8' });
    if (r.error) throw new Error(r.error.code === 'ENOENT' ? 'ffmpeg not found. Install FFmpeg first.' : r.error.message);
    if (r.status !== 0) throw new Error(`could not generate ${name}: ${r.stderr.trim()}`);
    made.push(file);
  }
  return made;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('make-sfx.mjs')) {
  const a = process.argv.slice(2);
  const i = a.indexOf('--out');
  try {
    const files = makeSfx(i > -1 ? resolve(a[i + 1]) : DEFAULT_SFX_DIR, { force: a.includes('--force') });
    console.log('sound effects ready:\n  ' + files.join('\n  '));
  } catch (e) { console.error('make-sfx failed: ' + e.message); process.exit(1); }
}
