---
name: video-production
description: Render HTML scenes to MP4 with Puppeteer and FFmpeg, sync voiceover, burn subtitles, export Shorts/Long formats. Use for rendering and export.
---
# Video Production
## Check first
Run: `bash tools/check-env.sh` (exit code 1 = something required is missing). Do not assume node, ffmpeg or Chrome exist. Report what is missing; ask before installing.
## One command
`npm run smoke` (3 s test) then `npm run build:short` or `npm run build:long`. Pipeline: env check → sound effects → render → audio + subtitles → verify. Options after `--`: `--fps 60`, `--start S --end E`, `--subs dom|burn|soft|none`, `--srt FILE`, `--png`, `--no-audio`, `--allow-missing`, `--gpu`.
Output: `studio/renders/<scene>-<format>.mp4` (+ `.srt`, + frames in `studio/renders/qc`). Approved finals are copied to `studio/exports` by hand after QC.
## Steps on their own
- Render (silent video + `.srt`): `node tools/render.mjs <scene.html> <out.mp4> --format short|long --fps 30|60`. JPEG frames by default, `--png` for lossless. Software WebGL by default so renders are reproducible; the scene is told it is rendering (`window.__RENDER__`), hides preview UI and stops its own loop. Only `window.setTime(i/fps)` draws frames.
- Mix: `node tools/mix.mjs <video.mp4> <out.mp4> [--subs none|burn|soft] [--srt FILE]`. Cue sheet: `studio/audio/timing.json`. Voice -14 LUFS, music -18 LUFS ducked ~12 dB under voice, master -14 LUFS, -1.5 dBTP.
- Verify: `node tools/verify.mjs <video.mp4> --format short --fps 30 --duration 30 --audio required`.
## Scene contract
`window.DURATION`, `window.setTime(t)`, `window.READY = true` after the first frame; optional `window.SUBTITLES = [{start,end,text}]`. Use a seeded random generator, never `Math.random()`.
## Verify
verify.mjs checks codec, size, fps, duration, audio stream, loudness and true peak and saves start/middle/end frames. Open those frames and look at them. Only then report done. If a step could not be run (for example no Chrome available), say so; never claim a render happened that did not.
