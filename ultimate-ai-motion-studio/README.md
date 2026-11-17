# Ultimate AI Motion Graphics Studio

Turns a script into a 3D animated video (Shorts 1080x1920 or long-form 1920x1080). Claude Code writes the scenes; a deterministic renderer turns them into an MP4 with sound effects, voiceover, music and subtitles.

## Files
- CLAUDE.md – studio rules, modes, pipeline (Claude Code reads this automatically)
- .claude/skills/*/SKILL.md – 6 skills (3d-motion, cinematic-direction, visual-storytelling, video-production, sound-design, animation-review)
- .claude/agents/*.md – 6 subagents (creative-director, 3d-artist, cinematic-director, animation-engineer, video-editor, quality-reviewer)
- studio/scenes/demo-studio.html – 30 s demo: opening, 3D typography, 3D business city, camera transition, psychology brain, ending
- studio/audio/timing.json – audio cue sheet (voiceover, music, sound-effect cues, mix levels)
- studio/{assets,animations,audio,storyboards,renders,exports} – working folders
- tools/ – `check-env.sh`, `render.mjs`, `make-sfx.mjs`, `mix.mjs`, `verify.mjs`, `build.mjs`, `qc-template.md`
- .github/workflows/unzip.yml – optional GitHub Action to unzip this archive inside a repo (the nested copy is inert; GitHub only reads the repo-root `.github`)

## Tools required
Node 18+ · FFmpeg/ffprobe (4.4+, with libx264; libass only for burned-in subtitles) · Puppeteer (installed by `npm install`) · Claude Code

## Install
    cd ultimate-ai-motion-studio          # the extracted folder, not the zip
    npm install                           # puppeteer, three (offline copy), http-server
    npx puppeteer browsers install chrome # only if npm did not download Chrome
    # FFmpeg: apt install ffmpeg | brew install ffmpeg | winget install ffmpeg
    npm run check                         # exits 1 and lists what is still missing

## Preview
    npm run serve   → open http://localhost:8080/studio/scenes/demo-studio.html
Three.js loads from cdnjs; if that is unreachable the page falls back to the copy in `node_modules/three`.
The preview shows a Pause button and a section label. Those never appear in rendered videos.

## Build a finished video (one command)
    npm run smoke          # 3-second test: render + sound effects + mix + verify (do this first)
    npm run build:short    # 1080x1920 -> studio/renders/demo-studio-short.mp4
    npm run build:long     # 1920x1080 -> studio/renders/demo-studio-long.mp4
`build` runs: environment check → sound effects → render → audio + subtitles → verify.
Extra options go after `--`, for example `npm run build:short -- --fps 60 --subs burn`:

| Option | Meaning |
|---|---|
| `--fps N` | frame rate (default 30) |
| `--start S --end E` | render only that part of the scene |
| `--subs dom\|burn\|soft\|none` | `dom` (default): captions drawn by the scene. `burn`: FFmpeg burns the `.srt` in. `soft`: switchable subtitle track. `none`: no captions |
| `--srt FILE` | your own subtitle file (e.g. timed to your voiceover); implies `burn` |
| `--png` | lossless PNG frames (slower, cleaner). Default is JPEG for speed |
| `--no-audio` | silent video |
| `--allow-missing` | skip configured audio files that do not exist (with a warning) instead of stopping |
| `--gpu` | use the machine's GPU instead of software WebGL (faster, but frames can differ slightly between machines) |
| `--chrome PATH` | use a specific Chrome/Chromium |

The pieces can also be run on their own: `npm run render:short`, `node tools/mix.mjs`, `node tools/verify.mjs`, `npm run sfx`.

## Audio
- **Sound effects** (whoosh, impact, riser, tick) are synthesised by FFmpeg into `studio/audio/generated/` (git-ignored). No downloads, no copyright issues. The demo's cues are already placed on the scene's beats.
- **Voiceover and music are yours to supply.** Put the files in `studio/audio/` and set `"voiceover": "studio/audio/vo.mp3"` and/or `"music": "studio/audio/music.mp3"` in `studio/audio/timing.json`. Both are `null` (off) by default.
- A configured file that does not exist stops the build with a clear message.
- Mix: voice normalised to -14 LUFS, music to -18 LUFS and ducked about 12 dB under the voice (looped and faded out to fit), then the whole mix is normalised to -14 LUFS with a -1.5 dBTP limiter. All values are in `timing.json` → `mix`.
- Add your own sound-effect cues with `{ "t": 12.5, "type": "sfx", "file": "studio/audio/my-hit.wav", "gain_db": -6 }` or `{ "t": 12.5, "type": "sfx", "preset": "tick" }`.

## Subtitles
The scene lists its captions in one place (`SUBS` → `window.SUBTITLES`); the renderer writes them to `<video>.srt`. To caption your own voiceover, write an `.srt` and run `npm run build:short -- --srt my-captions.srt`.

## Reliable rendering
Rendering uses software WebGL by default, a seeded random generator, and the scene's own animation loop is disabled while rendering, so the same scene gives the same frames every time. Errors in the scene, a failed FFmpeg, or a missing tool stop the render with a message and leave no half-written output.

## Activate modes
Open Claude Code in this folder and write: "Use MODE 1 …", "MODE 2 …", or "MODE 3 …" (see CLAUDE.md).

## Submit a script
Copy studio/storyboards/script-template.md, fill it, then: "Use MODE 3 on studio/storyboards/my-script.md, format short, 30 fps".

## Output
Builds go to `studio/renders` (MP4s and `.srt` files are git-ignored; verification frames are in `studio/renders/qc`). Final approved files go to `studio/exports`.
