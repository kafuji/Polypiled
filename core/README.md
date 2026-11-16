# Game core

The game itself: NetHack 5.0 source with this project's changes, compiled to
WebAssembly and loaded by the client in `src/runtime/`.

- `NetHack/`: the source tree, vendored with `git subtree` (squashed).
- `build-wasm.sh`: builds `build/nethack.js` and `build/nethack.wasm`.

Everything under `core/` is distributed under the NetHack General Public
License (`NetHack/dat/license`).

## Provenance

| Layer | Source |
| --- | --- |
| Upstream base | [NetHack/NetHack](https://github.com/NetHack/NetHack), branch `NetHack-5.0`, commit `b1c3c61a63f463d27f4b2fb80f448e96ea9bf545` (2026-11-15, 5.0.1 work in progress) |
| WebAssembly integration | [JamesIV4/NetHack](https://github.com/JamesIV4/NetHack), branch `forked-wasm-5`, commit `e76b93423a3dd4432e2a46bc47066a8ba529f468`, by James Pound and Adam Powers |

The subtree started from upstream commit `f3fc8537a` (2026-09-23), which was
already 610 commits past the `NetHack-5.0.0_Released` tag (2026-05-02).

To list every file that differs from the upstream base:

```bash
git diff --stat 5bcf198fdc: HEAD:core/NetHack
```

`5bcf198fdc` is the squashed upstream snapshot last merged; after the next
`git subtree pull`, use the new `Squashed 'core/NetHack/' changes` commit.

## Building

The build needs a POSIX host with `make`, `cc` and an activated
Emscripten SDK, so it runs in CI: the
[Build game core](../.github/workflows/build-core-wasm.yml) workflow builds
every push that touches `core/`, checks the result against the interface of
the artifacts in `public/`, starts a game on it, and uploads the build.

On such a host:

```bash
bash core/build-wasm.sh
```

## Shipping a build

The client loads the checked-in `public/nethack-5.js` and
`public/nethack-5.wasm`, so a core change reaches players only when those
files are replaced with a CI build of it:

1. Download the `game-core-wasm` artifact of the workflow run for the commit
   (`gh run download <run-id> --name game-core-wasm --dir <dir>`).
2. Copy `nethack.js` to `public/nethack-5.js` and `nethack.wasm` to
   `public/nethack-5.wasm`.
3. Regenerate the glyph catalog with `npm run glyphs:generate -- 5.0`; it
   records the hashes of both files and must otherwise come out unchanged.
4. Check saves made before the change still load (the workflow does this for
   the build; `scripts/wasm/save-compat-core.mjs` runs it by hand).

The build is not bit-reproducible, so the shipped files cannot be verified by
rebuilding; note the workflow run they came from in the commit message.

The first build shipped this way (2026-11-13) differs from the earlier
binaries only in the Emscripten version (7.0.0): same glyph catalog, saves load
in both directions.

## Taking upstream changes

```bash
git subtree pull --prefix=core/NetHack https://github.com/NetHack/NetHack.git NetHack-5.0 --squash
```

This fetches the full upstream history (about 170 MB) and merges it into
`core/NetHack`, with conflicts wherever this project changed the same lines.

Upstream renames its hints files with each patch level (`*.500` became
`*.501`). The WebAssembly build flags live in
`sys/unix/hints/include/cross-pre2.<level>`, so a rename shows up as a
modify/delete conflict on that file: carry the changes over to the new name,
and update the hints file `build-wasm.sh` passes to `setup.sh`.
