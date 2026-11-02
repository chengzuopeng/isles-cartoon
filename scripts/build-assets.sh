#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ART="$ROOT/art"
OUT="$ROOT/public/assets"
TOOL="${TMPDIR:-/tmp}/isles-cartoon-art-tool"

if [[ ! -x "$TOOL" || "$ROOT/scripts/art-tool.swift" -nt "$TOOL" ]]; then
  swiftc -O "$ROOT/scripts/art-tool.swift" -o "$TOOL"
fi

key() { "$TOOL" key "$ART/$1" "$OUT/$2" "$3" "$4" "${5:-0.04}" "${6:-center}"; }
seam() { "$TOOL" seam "$ART/$1" "$OUT/$2" "$3" "$4" "${5:-0.08}"; }
split() { "$TOOL" split "$ART/$1" "$OUT/$2" "$3" "$4" "$5" "$6" "${7:-0.04}" "${8:-0}"; }
region() { "$TOOL" region "$ART/$1" "$OUT/$2" "$3" "$4" "$5" "$6" "$7" "$8" "${9:-0.04}"; }

seam scenes/sky-ch1.png scenes/sky-ch1.jpg 2048 742 0.08
split concept/sfx-lettering.png ui/sfx/word 3 2 384 256 0.03
region concept/sfx-lettering.png ui/sfx/word-5.png 0.3334 0.5 0.635 1 384 256 0.03
region ui/items/food.png ui/items/food-bread.png 0 0 0.5 1 256 256 0.04
region ui/items/food.png ui/items/food-apple.png 0.5 0 1 1 256 256 0.04
key bosses/scarecrow/wanted.png portraits/scarecrow-wanted.png 480 720 0.01 bottom

MODELS=()
if [[ ${#MODELS[@]} -gt 0 ]]; then
  glbs=()
  for entry in "${MODELS[@]}"; do
    id="${entry##*/}"
    dir="${entry%/*}"
    glbs+=("$ART/models/$dir/$id.glb" "$OUT/models/$id.glb")
  done
  node "$ROOT/scripts/pack-glb.mjs" "${MODEL_TEXTURE_MAX:-1024}" "${glbs[@]}"
fi

BASIS="$ROOT/node_modules/three/examples/jsm/libs/basis"
mkdir -p "$OUT/basis"
cp "$BASIS/basis_transcoder.js" "$BASIS/basis_transcoder.wasm" "$OUT/basis/"
