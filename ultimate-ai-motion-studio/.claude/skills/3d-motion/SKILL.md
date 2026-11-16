---
name: 3d-motion
description: Build Three.js/GSAP/WebGL 3D scenes, typography, charts and particles for business, finance, psychology and self-improvement videos. Use for any 3D scene or asset work.
---
# 3D Motion
## Process
1. Define the one idea the scene must communicate.
2. Build with Three.js (CDN r128 from cdnjs) in a single HTML file; one function per object (makeCity, makeBrain...).
3. Drive everything from a timeline update(t); expose window.setTime.
4. Materials: MeshStandardMaterial (PBR), restrained emissive. Soft shadows, fog for depth.
5. Performance: <=150 draw calls, reuse geometry, cap pixel ratio at 2, no per-frame allocations.
## Libraries
- Business: skyscrapers, growth stagger, flow lines.
- Finance: extruded bar/line charts, coin stacks, wealth-gap scale.
- Psychology: node/edge brain, pulse propagation, bias diagrams.
- Self-improvement: loop rings, time bars, before/after silhouettes.
## Rules
Easing: smoothstep/ease-in-out only. Stagger 40-120 ms. No glow spam. Text must be readable at phone size (>= 6% of frame height).
