---
name: animation-review
description: Quality-review workflow scoring each scene out of 100 from real inspection. Use before approving any scene or final video.
---
# Animation Review
Score per scene (100): Visual quality 15, Smoothness 15, Consistency 10, Camera 10, Lighting 10, Typography readability 10, Mobile performance 10, Browser compat 5, Render errors 5, Voiceover sync 5, Export quality 5.
## Method (real evidence only)
- Open in browser/headless, read console errors.
- Capture frames at several times via setTime and view them.
- Measure fps if possible; test 1080x1920 and 1920x1080.
- Untestable items: mark 'not verified' and exclude from score, never guess.
## Gate
Below 85: list weaknesses, fix, re-review. Record in studio/renders/qc-report.md using tools/qc-template.md.
