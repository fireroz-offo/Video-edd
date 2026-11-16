# Ultimate AI Motion Graphics Studio

## Files
- CLAUDE.md – studio rules, modes, pipeline (Claude Code reads this automatically)
- .claude/skills/*/SKILL.md – 6 skills (3d-motion, cinematic-direction, visual-storytelling, video-production, sound-design, animation-review)
- .claude/agents/*.md – 6 subagents (creative-director, 3d-artist, cinematic-director, animation-engineer, video-editor, quality-reviewer)
- studio/scenes/demo-studio.html – 30 s demo: opening, 3D typography, 3D business city, camera transition, psychology brain, ending
- studio/{assets,animations,audio,storyboards,renders,exports} – working folders
- tools/check-env.sh, tools/render.mjs, tools/qc-template.md
- .github/workflows/unzip.yml – optional GitHub Action to unzip this archive inside a repo

## Tools required
Browser (preview) · Node 18+ · Puppeteer · FFmpeg/ffprobe · Claude Code

## Install
    unzip ultimate-ai-motion-studio.zip && cd ultimate-ai-motion-studio
    bash tools/check-env.sh
    npm install            # installs puppeteer
    # FFmpeg: apt install ffmpeg | brew install ffmpeg | winget install ffmpeg

## Preview
    npx http-server . -p 8080   → open http://localhost:8080/studio/scenes/demo-studio.html
(needs internet: Three.js loads from cdnjs)

## Activate modes
Open Claude Code in this folder and write: "Use MODE 1 …", "MODE 2 …", or "MODE 3 …" (see CLAUDE.md).

## Submit a script
Copy studio/storyboards/script-template.md, fill it, then: "Use MODE 3 on studio/storyboards/my-script.md, format short, 30 fps".

## Render / export
    npm run render:short   # 1080x1920
    npm run render:long    # 1920x1080
Output goes to studio/renders; final approved files to studio/exports. Voiceover, music, SFX and subtitles are mixed by the video-editor agent per tools in skill video-production.
