---
name: animation-review
description: Quality-review workflow scoring each scene out of 100 from real inspection. Use before approving any scene or final video.
---
# Animation Review
Score per scene (100): Visual quality 15, Smoothness 15, Consistency 10, Camera 10, Lighting 10, Typography readability 10, Mobile performance 10, Browser compat 5, Render errors 5, Voiceover sync 5, Export quality 5.
## Method (real evidence only)
- Run `node tools/verify.mjs <video.mp4> --format short|long --fps N --audio required|none`; it checks the file and saves start/middle/end frames in `studio/renders/qc`. Open those frames and look at them.
- Render errors: the renderer stops on any page error, so a finished render is evidence of zero scene errors; quote its output.
- Capture more frames with `node tools/render.mjs <scene> <out.mp4> --start S --end E` for the moments you want to judge.
- Test both 1080x1920 and 1920x1080 (`--format short` / `long`).
- Untestable items: mark 'not verified' and exclude from score, never guess.
## Gate
Below 85: list weaknesses, fix, re-review. Record in studio/renders/qc-report.md using tools/qc-template.md.
