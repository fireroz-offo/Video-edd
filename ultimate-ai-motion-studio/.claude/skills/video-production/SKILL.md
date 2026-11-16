---
name: video-production
description: Render HTML scenes to MP4 with Puppeteer and FFmpeg, sync voiceover, burn subtitles, export Shorts/Long formats. Use for rendering and export.
---
# Video Production
## Check first
Run: bash tools/check-env.sh. Do not assume node, ffmpeg, chromium exist. Report what is missing; ask before installing.
## Render
node tools/render.mjs <scene.html> <out.mp4> --format short|long --fps 30|60
Frames are captured by calling window.setTime(i/fps), then encoded with FFmpeg (libx264, yuv420p, crf 18, +faststart).
Formats: short 1080x1920, long 1920x1080.
## Combine
Concat scenes with the ffmpeg concat demuxer; mix voiceover + music (duck music -12 dB under voice) + sfx at cue times from studio/audio/timing.json; burn subtitles from .srt with the subtitles filter.
## Verify
ffprobe resolution/fps/duration; extract frames at start/middle/end and look at them. Only then report done.
