---
name: sound-design
description: Plan sound effects, music and mixing cues synced to scenes and voiceover. Use for audio planning.
---
# Sound Design
- Cue sheet: `studio/audio/timing.json`. Top level: `voiceover` and `music` (file path or `null`), `mix` (levels), `cues`. A cue is `{ "t": seconds, "type": "sfx", "preset": "whoosh|impact|riser|tick" | "file": "path", "gain_db": -8, "note": "why" }`. Paths are relative to the project folder.
- Built-in sounds are synthesised by FFmpeg (`npm run sfx`, output in `studio/audio/generated`). Use presets for whooshes on camera travel, a soft impact on text land, a riser before reveals, a tick for data counters. Place each cue on a real beat in the scene (camera keyframes, reveal times); do not guess times.
- Music: ambient/pulse bed around -18 LUFS, voice around -14 LUFS, music ducked about 12 dB under voice. These are the `mix` defaults and are applied by `tools/mix.mjs`.
- Use only royalty-free or user-owned audio. The user supplies voiceover and music. Never invent files that do not exist; list the files the user must supply. A configured file that is missing stops the build.
- Leave 150-300 ms silence before the key line.
