#!/usr/bin/env bash
# Checks everything the render/mix pipeline needs. Exit code 0 = ready, 1 = something required is missing.
# Usage: bash tools/check-env.sh [--need-libass]
#   --need-libass  also require FFmpeg's "subtitles" filter (needed only for --subs burn)
cd "$(dirname "$0")/.." || exit 1
need_libass=0; [ "$1" = "--need-libass" ] && need_libass=1
bad=0
ok()   { printf 'OK      %s\n' "$1"; }
warn() { printf 'WARN    %s\n' "$1"; }
miss() { printf 'MISSING %s\n' "$1"; bad=1; }

# Node >= 18
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" -ge 18 ]; then ok "node $(node --version)"; else miss "node $(node --version) is too old (need 18 or newer)"; fi
else miss "node (install Node 18+)"; fi
command -v npm >/dev/null 2>&1 && ok "npm $(npm --version)" || warn "npm not found (needed only to install dependencies)"

# FFmpeg and the pieces the pipeline uses
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
  ok "ffprobe"
  enc=$(ffmpeg -hide_banner -encoders 2>/dev/null); flt=$(ffmpeg -hide_banner -filters 2>/dev/null)
  echo "$enc" | grep -q ' libx264 ' && ok "ffmpeg encoder libx264" || miss "ffmpeg encoder libx264 (this FFmpeg build cannot make H.264)"
  echo "$enc" | grep -q ' aac '     && ok "ffmpeg encoder aac"     || miss "ffmpeg encoder aac"
  for f in loudnorm sidechaincompress amix adelay alimiter aevalsrc anoisesrc ebur128; do
    echo "$flt" | grep -qE " $f " && ok "ffmpeg filter $f" || miss "ffmpeg filter $f"
  done
  ffmpeg -hide_banner -h filter=amix 2>/dev/null | grep -q normalize && ok "ffmpeg amix normalize option (FFmpeg 4.4+)" || miss "ffmpeg amix 'normalize' option (upgrade FFmpeg to 4.4 or newer)"
  if echo "$flt" | grep -qE ' subtitles '; then ok "ffmpeg filter subtitles (libass)"
  elif [ "$need_libass" = 1 ]; then miss "ffmpeg filter subtitles (libass) - needed for --subs burn; use --subs dom or soft instead"
  else warn "ffmpeg has no libass: --subs burn will not work (dom and soft still do)"; fi
else
  miss "ffmpeg / ffprobe (apt install ffmpeg | brew install ffmpeg | winget install ffmpeg)"
fi

# Puppeteer and a Chrome it can launch
if [ -d node_modules/puppeteer ]; then
  ok "puppeteer"
  exe=$(node -e "import('puppeteer').then(p=>console.log(p.default.executablePath())).catch(()=>{})" 2>/dev/null)
  if [ -n "$exe" ] && [ -x "$exe" ]; then ok "chrome for puppeteer ($exe)"
  else
    sys=""; for c in google-chrome google-chrome-stable chromium chromium-browser; do command -v $c >/dev/null 2>&1 && { sys=$c; break; }; done
    if [ -n "$sys" ]; then warn "puppeteer's own Chrome is not downloaded; found system $sys. Render with --chrome \"$(command -v $sys)\" or run: npx puppeteer browsers install chrome"
    else miss "chrome (run: npx puppeteer browsers install chrome)"; fi
  fi
else
  miss "puppeteer (run: npm install)"
fi
[ -d node_modules/three ] && ok "three (offline fallback for the preview)" || warn "three not installed (the scene loads Three.js from the internet; npm install adds an offline copy)"

if [ "$bad" = 0 ]; then echo; echo "environment ready"; else echo; echo "environment NOT ready: fix the MISSING items above"; fi
exit $bad
