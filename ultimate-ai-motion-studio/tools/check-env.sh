#!/usr/bin/env bash
for t in node npm ffmpeg ffprobe python3 chromium chromium-browser google-chrome; do
  if command -v $t >/dev/null 2>&1; then echo "OK      $t $($t --version 2>/dev/null | head -1)"; else echo "MISSING $t"; fi
done
[ -d node_modules/puppeteer ] && echo "OK      puppeteer" || echo "MISSING puppeteer (npm i puppeteer)"
