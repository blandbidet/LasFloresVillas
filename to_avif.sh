#!/usr/bin/env bash
# =====================================================================
#  to_avif.sh — convert every site image to AVIF and update the source
# ---------------------------------------------------------------------
#  Run from your project root:
#      chmod +x to_avif.sh
#      ./to_avif.sh --dry-run     # see what would happen, change nothing
#      ./to_avif.sh               # do it
#
#  What it does:
#    1. Converts every referenced image to AVIF, resized per role
#    2. Builds a thumbs/ folder in each gallery (the strip under the
#       slideshow renders at 46x32 CSS px but loads full photos today)
#    3. Rewrites the filenames inside src/index.html
#    4. Runs `node build.js`
#
#  Originals are never deleted. A backup of src/index.html is written
#  before any edit.
#
#  Requires: avifenc (libavif-bin) and ImageMagick
#      Ubuntu/Debian  sudo apt-get install libavif-bin imagemagick
#      macOS          brew install libavif imagemagick
#      Fedora         sudo dnf install libavif-tools ImageMagick
# =====================================================================

set -uo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

# ---- Tunables -------------------------------------------------------
Q_FULL=55        # AVIF quality for full images (~JPEG 80)
Q_THUMB=60       # AVIF quality for thumbnails
SPEED=6          # 0 = slowest/smallest, 10 = fastest/largest
THUMB_W=140      # thumbnails render at 46px CSS; 140 covers 3x retina

# folder:max_width  — heroes stay larger, galleries smaller
declare -A WIDTHS=(
  [slide_photos]=2000
  [villa_header_photos]=2000
  [home_photos]=1400
  [hawksbill_photos]=1600
  [jasmine_photos]=1600
  [periwinkle_photos]=1600
  [rosebay_photos]=1600
)
# galleries get a thumbs/ subfolder
GALLERIES=(hawksbill_photos jasmine_photos periwinkle_photos rosebay_photos)

# ---- Preflight ------------------------------------------------------
command -v avifenc >/dev/null || {
  echo "ERROR: avifenc not found."
  echo "  Ubuntu/Debian: sudo apt-get install libavif-bin"
  echo "  macOS:         brew install libavif"
  echo "  Fedora:        sudo dnf install libavif-tools"
  exit 1; }

MAGICK=$(command -v magick || command -v convert) || {
  echo "ERROR: ImageMagick not found (needed for resizing)."; exit 1; }

[[ -f src/index.html ]] || { echo "ERROR: run this from the folder containing src/index.html"; exit 1; }

echo "avifenc     : $(command -v avifenc)"
echo "ImageMagick : $MAGICK"
[[ $DRY_RUN == 1 ]] && echo "MODE        : DRY RUN (nothing will be written)"
echo

# ---- Convert one file ----------------------------------------------
# $1 source  $2 dest  $3 max width  $4 quality
convert_one() {
  local src="$1" dest="$2" width="$3" q="$4" tmp
  tmp=$(mktemp --suffix=.png 2>/dev/null || mktemp -t avif).png
  "$MAGICK" "$src" -auto-orient -resize "${width}x>" -strip "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
  avifenc -q "$q" --speed "$SPEED" --jobs all "$tmp" "$dest" >/dev/null 2>&1
  local rc=$?
  rm -f "$tmp"
  return $rc
}

# ---- Main loop ------------------------------------------------------
total_before=0; total_after=0; n_ok=0; n_fail=0; n_thumb=0
declare -a RENAMES=()

for dir in "${!WIDTHS[@]}"; do
  [[ -d "$dir" ]] || { echo "skip: $dir (not found)"; continue; }
  width="${WIDTHS[$dir]}"

  is_gallery=0
  for g in "${GALLERIES[@]}"; do [[ "$g" == "$dir" ]] && is_gallery=1; done
  [[ $is_gallery == 1 && $DRY_RUN == 0 ]] && mkdir -p "$dir/thumbs"

  echo "$dir  (max ${width}px$( [[ $is_gallery == 1 ]] && echo ", + thumbs" ))"

  # -maxdepth 1 so we never re-process thumbs/
  while IFS= read -r -d '' f; do
    base=$(basename "$f")
    stem="${base%.*}"
    ext="${base##*.}"

    # HEIC files here are duplicates of a .jpg the site already uses
    shopt -s nocasematch
    if [[ "$ext" == "heic" && -f "$dir/$stem.jpg" ]]; then
      echo "    - $base  (skipped: duplicate of $stem.jpg)"
      shopt -u nocasematch; continue
    fi
    shopt -u nocasematch

    sz_before=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")
    total_before=$((total_before + sz_before))

    if [[ $DRY_RUN == 1 ]]; then
      printf "    %-46s %7s KB  ->  %s.avif\n" "$base" "$((sz_before/1024))" "$stem"
      RENAMES+=("$base|$stem.avif")
      continue
    fi

    if convert_one "$f" "$dir/$stem.avif" "$width" "$Q_FULL"; then
      sz_after=$(stat -c%s "$dir/$stem.avif")
      total_after=$((total_after + sz_after))
      n_ok=$((n_ok+1))
      RENAMES+=("$base|$stem.avif")
      printf "    %-46s %7s KB  ->  %6s KB\n" "$base" "$((sz_before/1024))" "$((sz_after/1024))"
    else
      n_fail=$((n_fail+1))
      echo "    FAILED: $base"
      continue
    fi

    if [[ $is_gallery == 1 ]]; then
      convert_one "$f" "$dir/thumbs/$stem.avif" "$THUMB_W" "$Q_THUMB" \
        && n_thumb=$((n_thumb+1))
    fi
  done < <(find "$dir" -maxdepth 1 -type f \
             \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
                -o -iname '*.heic' -o -iname '*.tif' -o -iname '*.tiff' \) -print0)
  echo
done

# ---- Summary --------------------------------------------------------
if [[ $DRY_RUN == 1 ]]; then
  echo "DRY RUN complete — ${#RENAMES[@]} file(s) would be converted."
  echo "Re-run without --dry-run to apply."
  exit 0
fi

echo "-------------------------------------------------"
printf "  converted   : %d file(s)%s\n" "$n_ok" \
  "$( [[ $n_fail -gt 0 ]] && echo "   ($n_fail FAILED)" )"
printf "  thumbnails  : %d\n" "$n_thumb"
printf "  originals   : %8.1f MB\n" "$(echo "$total_before/1048576" | bc -l)"
printf "  AVIF        : %8.1f MB\n" "$(echo "$total_after/1048576" | bc -l)"
if [[ $total_before -gt 0 ]]; then
  printf "  saved       : %8.0f%%\n" \
    "$(echo "100*(1-$total_after/$total_before)" | bc -l)"
fi
echo "-------------------------------------------------"
echo

# ---- Rewrite src/index.html ----------------------------------------
stamp=$(date +%Y%m%d-%H%M%S)
cp src/index.html "src/index.html.backup-$stamp"
echo "Backed up  src/index.html.backup-$stamp"

RENAME_LIST=$(mktemp)
printf '%s\n' "${RENAMES[@]}" > "$RENAME_LIST"

python3 - src/index.html "$RENAME_LIST" <<'PY'
import sys, re
path, listfile = sys.argv[1], sys.argv[2]
pairs = [ln.strip().split('|', 1)
         for ln in open(listfile, encoding='utf-8') if '|' in ln]
html = open(path, encoding='utf-8').read()
changed = 0
# longest first, so "5D3A2787_2.jpg" is handled before "5D3A2787.jpg"
for old, new in sorted(pairs, key=lambda p: -len(p[0])):
    n = html.count(old)
    if n:
        html = html.replace(old, new)
        changed += n
open(path, 'w', encoding='utf-8').write(html)
print(f"Rewrote    {changed} image reference(s) in src/index.html")

leftover = re.findall(r'[\w /.-]+\.(?:jpe?g|JPG|JPEG|png|PNG|HEIC)', html)
if leftover:
    print("  NOTE: still referencing non-AVIF files:")
    for l in sorted(set(leftover)):
        print("    " + l)
PY
rm -f "$RENAME_LIST"

# ---- Point the thumbnail strip at thumbs/ ---------------------------
python3 - src/index.html <<'PY'
import sys
path = sys.argv[1]
html = open(path, encoding='utf-8').read()
old = '<img src="${u}" alt="${v.name} — thumbnail ${i+1}" loading="lazy">'
new = ('<img src="${u.replace(/\\/([^\\/]+)$/, \'/thumbs/$1\')}" '
       'alt="${v.name} — thumbnail ${i+1}" width="46" height="32" '
       'loading="lazy" decoding="async">')
if old in html:
    open(path, 'w', encoding='utf-8').write(html.replace(old, new))
    print("Patched    thumbnail strip -> thumbs/ (+ width/height, no layout shift)")
elif '/thumbs/' in html:
    print("Patched    thumbnail strip already points at thumbs/")
else:
    print("  NOTE: thumbnail <img> not found; strip still loads full images.")
PY

# ---- Rebuild --------------------------------------------------------
echo
if command -v node >/dev/null; then
  echo "Running node build.js ..."
  node build.js
else
  echo "node not found — run 'node build.js' yourself to regenerate the pages."
fi

cat <<'EOF'

Done. Next:
  1. python3 -m http.server 8000     and check every villa page
  2. Confirm the slideshow, thumbnail strip and lightbox all still work
  3. Only then consider moving the .jpg originals out of the repo —
     they are your only full-resolution masters, and AVIF is lossy.
EOF
