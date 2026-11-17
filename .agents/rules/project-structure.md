# Project Structure Steering

This is a living steering doc. Update it whenever architecture, file ownership, or runtime contracts change.

## Related Steering Docs

- [Engine architecture and code hotspots](../../src/game/engine/README.md)
- [React UI architecture and code hotspots](../../src/ui/README.md)
- [Runtime architecture and code hotspots](../../src/runtime/local/README.md)
- [Input and player/cursor movement](movement-flow.md)
- [Change playbook](logic-hotspots.md)
- [World/runtime flow guide](../../docs/engine-world-runtime.md)

## Top-Level Layout

- `index.html`: Vite HTML entry point.
- `src/main.tsx`: React app bootstrap and engine mount.
- `quest/`: isolated Meta Spatial SDK APK with a floating WebView UI and native stereo geometry in Windowed MR and Immersive modes. `QuestWebBridge` owns origin-scoped scene packet assembly; `stereo/` owns native render resources and clipping.
- `src/quest/native/`: native message transport, UI transparency and gated game commands. `engine/rendering/quest-scene-export*` mirrors resolved Three resources after engine visual updates; it does not duplicate runtime/glyph logic. See [stereo architecture](../../docs/quest-stereo-vr.md).
- `quest-wired.html`, `src/quest/wired-viewer/`, and `scripts/quest/wired/`: PCVR development adapter that streams an isolated Electron document into a WebXR panel; it does not change the bundled APK architecture.
- `quest-ui-probe.html` and `src/quest/ui-probe/`: standalone React interaction fixture using real UI components, with no NetHack runtime boot.
- `scripts/quest/`: Quest-specific generated asset staging and regression checks; `build:quest` uses a separate Vite entry/output. See [Quest plan](../../docs/quest-vr-plan.md).
- `src/app.ts`: debug helper registration.
- `src/ui/App.tsx`: React entry point and app composition.
- `src/ui/app/`: feature hooks, components and helpers, grouped into startup, settings, controller, menus, inventory, status, scores, tilesets, updates and shared presentation. See the [UI ownership map](../../src/ui/README.md#code-hotspots).
- `src/state/gameStore.ts`: Zustand store for live UI/game state.
- `src/state/engineUiAdapter.ts`: bridge from engine updates into the store.
- `src/game/Nethack3DEngine.ts`: main engine orchestration layer for rendering, input, camera, and runtime events.
- `src/game/engine/`: state-owning subsystems with explicit typed dependencies, grouped by responsibility. Public controller calls delegate from `Nethack3DEngine` to these classes.
- `src/game/index.ts`: public game barrel.
- `src/game/controller-bindings.ts`: controller action schema, defaults, parsing, and normalization.
- `src/game/tilesets.ts`: builtin, user, and Vulture tileset catalog and asset resolution.
- `src/game/user-tileset-storage.ts`: persistence for imported user tilesets.
- `src/game/helpers/startup-character-rulesets.ts`: startup role, race, gender, and alignment rulesets generated from `core/NetHack/src/role.c`.
- `src/game/helpers/startup-character-constraints.ts`: startup character selection normalization and option resolution.
- `src/game/glyphs/index.ts`: public glyph helper barrel.
- `src/game/glyphs/registry.ts`: glyph catalog lookup. NetHack 5.0's catalog is the only one and is always loaded.
- `src/game/glyphs/behavior.ts`: tile classification and default terrain glyph helpers.
- `src/game/glyphs/overrides.ts`: runtime glyph override registry.
- `src/game/glyphs/glyph-catalog.5.generated.ts`: checked-in generated glyph fallback/reference for NetHack 5.0 (`npm run glyphs:generate`; not authoritative for all item-variation tiles).
- `src/game/tileset-367-to-5-translation.ts`: tile-index translation that lets 3.6.7-layout tilesets (`public/assets/3.6/*`, Vulture, user imports) be drawn by NetHack 5.0. "3.6.7" here names an atlas layout, not a game.
- `src/game/vulture/translation.ts`: Vulture projection and tileset translation adapter.
- `src/game/vulture/legacy-tile-identities.ts`: fixed table from a 3.6.7 tile index to the monster, object or map symbol on it. Vulture names its images after NetHack 3.6 identities, so a 5.0 tile is translated to its 3.6.7 tile and looked up here. The table was derived once from data that is no longer in the repository and does not change with the core.
- `src/audio/index.ts`: public audio barrel.
- `src/audio/FmodRuntime.ts`: FMOD runtime bootstrap and wrapper.
- `src/audio/sound-pack-storage.ts`: sound-pack persistence.
- `src/runtime/index.ts`: public runtime barrel.
- `src/runtime/LocalNetHackRuntime.ts`: public runtime facade and ordered startup, callback dispatch, event emission, and shutdown coordination.
- `src/runtime/local/`: state-owning runtime subsystems with explicit peer dependencies; `create-runtime-systems.ts` assembles them and `runtime-coordinator.ts` defines their root-operation contract.
- `src/runtime/runtime-worker.ts`: worker entry that hosts the runtime.
- `src/runtime/WorkerRuntimeBridge.ts`: main-thread worker bridge.
- `src/runtime/input/RuntimeInputBroker.ts`: broker for event, menu, and position input.
- `src/runtime/startup-init-options.ts`: startup option schema, normalization, serialization, and required token handling.
- `src/runtime/runtime-capabilities.ts`: feature gates read from the shipped NetHack 5.0 build.
- `src/runtime/save-storage.ts`: save-path and database-name helpers.
- `src/runtime/displayFileCatalog.ts`: bundled help and display-file text catalog.
- `src/runtime/types.ts`: runtime commands, envelopes, and shared bridge types.
- `src/runtime/knowledge.ts`: player knowledge frames from the core (`core/NetHack/win/shim/nh3d_knowledge.c`): format, decoding and shared types. `src/game/engine/world/player-knowledge.ts` holds the engine-side state; renderers read it and fall back to their own estimates until a frame arrives. See [player knowledge](../../docs/player-knowledge-interface.md).
- `src/storage/client-options-storage.ts`: IndexedDB persistence plus localStorage migration for client options and startup preferences.
- `src/plus/wiki-links/`: Ctrl-held NetHackWiki links and original-name tooltips for names in the message log, inventory and menus. See [localization](../../docs/game-message-localization.md#nethackwiki-links).
- `src/update/github-version-checker.ts`: GitHub release/version checks used by the UI.
- `src/update/types.ts`: update type definitions.
- `public/assets/*`: shipped images, UI icons, and Vulture asset roots.
- `public/nethack-5.js`, `public/nethack-5.wasm`: the checked-in runtime artifact consumed by the browser build. NetHack 5.0 is the only runtime; there is no runtime choice in the UI.
- `core/NetHack/*`: the game core's C source (NetHack 5.0 plus this project's changes), vendored with `git subtree`. `core/build-wasm.sh` builds it to `core/build/`; the build runs in CI (`.github/workflows/build-core-wasm.yml`), not on Windows. See [core/README.md](../../core/README.md). `public/nethack-5.*` are CI builds of it, replaced by hand as that README describes.
- `scripts/wasm/compare-core-build.mjs`, `scripts/wasm/smoke-core.mjs`, `scripts/wasm/save-compat-core.mjs`: interface comparison, boot check and save-compatibility check for a built core.
- Data read from `core/NetHack` outside the core build: help files (`dat/`, bundled by `src/runtime/displayFileCatalog.ts`), tile files (`win/share/`, for `npm run hires:tile-keys` and the AI tileset prompts) and `src/role.c` (startup rulesets).
- `third_party/vulture/*`: vendored Vulture source reference.
- `scripts/glyphs/*`: glyph catalog generation and validation.
- `scripts/wasm/*`: checks for a built core (interface comparison, boot, save compatibility, callback bridge).
- `scripts/updates/*`: update packaging helpers.
- `electron/*`: Electron entry points and packaging support.
- `android/*`: Capacitor Android project.
- `build/*`, `dist/*`, `release/*`: build and packaging outputs.

## Runtime Architecture

1. `src/main.tsx` mounts React and its `App` component.
2. The React app composition wires feature hooks and views; its engine lifecycle creates the engine controller and UI adapter. Hooks run in their established order so listener priority, prompt focus and layout measurement remain stable. The engine assembles its state-owning subsystems with `createEngineSystems` before starting rendering and runtime work.
3. `Nethack3DEngine` creates a `WorkerRuntimeBridge`.
4. `WorkerRuntimeBridge` starts `src/runtime/runtime-worker.ts` as a module worker.
5. The worker creates `LocalNetHackRuntime`.
6. `LocalNetHackRuntime` assembles its runtime subsystems before starting WASM. Startup and persistence owners load artifacts and apply init options; `handleUICallback` preserves callback guards and dispatches to the relevant owner.
7. Runtime events flow back to `Nethack3DEngine.handleRuntimeEvent` for rendering and UI updates.

## Useful Commands

- Install dependencies: `npm i`
- Type-check only: `npm run check:tsc`
- Behavioral regressions: `npm test`
- Dev server: `npm run dev`
- Preview production build: `npm run preview`

## Reference Commands

- Build, packaging, and update commands live in `package.json`, including `npm run build`, `npm run build:electron`, `npm run update`, `npm run electron:*`, and `npm run android:*`.
- Agents should not run the build or packaging commands unless the user explicitly asks for that work.

## Runtime Logic Map

### `src/runtime/LocalNetHackRuntime.ts` and `src/runtime/local/`

- Public command intake, callback guards and dispatch, startup/reconnect ordering, and coordinated shutdown: `LocalNetHackRuntime.ts`.
- Input normalization and routing: `input/client-dispatch.ts`, `input/keyboard.ts`, and `input/mouse-poskey.ts` under `local/`.
- Broker ownership, active request identity, and waits: `input/input-requests.ts`; question callbacks: `input/questions.ts`; text callbacks: `input/text-input.ts`.
- Far-look and position input state: `input/position-selection.ts`; contextual look automation: `input/contextual-look.ts`.
- Menu capture callbacks: `menus/menu-capture.ts`; selections, `pendingMenuSelection`, and `menuSelectionReadyCount`: `menus/selection.ts`.
- Inventory context actions: `menus/inventory-context.ts`; inventory snapshots: `menus/inventory-snapshots.ts`; tile-context menus: `menus/tile-context.ts`.
- Extended command submissions and pending requests: `input/extended-commands.ts`; WASM command-table decoding: `input/extended-command-catalog.ts`.
- Map callbacks, `gameMap`, and `playerPosition`: `world/map-callbacks.ts`; refresh requests: `world/tile-refresh.ts`; pending item refreshes: `world/post-action-refresh.ts`; under-player item helpers: `world/under-player-items.ts`.
- Window text capture and map-window `clear_scene`: `messages/window-text.ts`; raw/text/history events: `messages/message-callbacks.ts`; prompt context: `messages/prompt-context.ts`.
- Status decoding, `statusPending`, and `latestStatusUpdates`: `status/status.ts`.
- Pointer contracts and callback validation: `abi/pointer-contract.ts`; heap reads and pointer normalization: `abi/memory.ts`.
- WASM startup, configuration and assets: `startup/`; save mounts, checkpoint recovery and locks: `persistence/`; game-over state: `lifecycle/game-over.ts`.
- See the [runtime ownership guide](../../src/runtime/local/README.md) for construction, dependency, and ordering invariants.

### `src/game/Nethack3DEngine.ts`

- Engine setup: constructor, `initThreeJS`, and `connectToRuntime`.
- Runtime event dispatcher: `handleRuntimeEvent`.
- Frame sequencing and coordinated lifecycle: `animate`, `dispose`, `clearScene`.
- Runtime/application option orchestration: `applyClientOptions`, `setClientOptions`, `applyPlayMode`.
- Public controller API delegates to the responsible subsystem.

### `src/game/engine/`

- Camera transforms and smoothing: `camera/camera.ts`.
- Browser keyboard intake: `input/keyboard-input.ts`; directional mapping: `input/movement-input.ts`.
- Shared command submission: `input/input-commands.ts` (`sendInput`, `sendInputSequence`, `sendMouseInput`).
- Mouse/touch/controller devices: `input/mouse-input.ts`, `input/touch-input.ts`, `input/controller-gameplay.ts`, `input/controller-dialogs.ts`.
- Position and far-look cursor state: `input/position-selection.ts`; raycasts: `input/pointer-targeting.ts`; pointer lock: `input/pointer-lock.ts`.
- Question selections, counts and pagination: `ui/question-menus.ts`; inventory, information and text dialogs: `ui/prompt-dialogs.ts`.
- Direction overlays: `ui/direction-prompts.ts`; extended-command palette: `ui/extended-commands.ts`; context actions and glance probes: `ui/tile-context-actions.ts`.
- Tile presentation: `rendering/tile-rendering.ts`, `rendering/tile-materials.ts`, `rendering/glyph-textures.ts`; frame resources and postprocessing: `rendering/render-pipeline.ts`.
- World snapshots and tile updates: `world/level-terrain-cache.ts`, `world/tile-updates.ts`, `world/world-classification.ts`; player and entity motion: `world/player-movement.ts`, `world/entity-movement.ts`.
- Status/HUD: `ui/player-status.ts`; postmortem lifecycle: `ui/game-over.ts`; telemetry: `world/run-telemetry.ts`; minimap: `ui/minimap.ts`.
- Audio/haptics: `audio/audio-haptics-platform.ts`; developer panels: `diagnostics/`. Effects and specialized rendering have separate owners. Search for the owning method inside `src/game/engine/` before extending a feature.
- `create-engine-systems.ts` assembles dependencies; `shared/` contains engine types and constants used by multiple subsystems.
- `runtime/engine-state.ts` owns configuration and lifecycle state; `world/player-movement.ts` owns `playerPos` and player movement state.
- Each subsystem owns its fields and receives narrow `Pick` contracts for the other owners it accesses. Assembly initializes eager dependencies before consumers and preserves synchronous runtime/frame ordering. Gameplay subsystems still collaborate through these declared contracts.

## Runtime Event Contract

- Common map events: `map_glyph`, `map_glyph_batch`, `player_position`, `map_cursor`, `tile_not_found`, `area_refresh_complete`, `clear_scene`.
- Common UI events: `text`, `raw_print`, `question`, `direction_question`, `position_request`, `name_request`, `text_request`, `inventory_update`, `info_menu`, `extended_commands`.
- Common state events: `position_input_state`, `position_cursor`, `number_pad_mode`, `status_update`, `runtime_globals_snapshot`, `runtime_object_tile_map`, `damage_event`, `game_over_complete`, `inventory_updated_signal`.
- Entity/item events include `monster_attack`, `monster_killed`, `confirmed_boulder_push`, `under_player_item_glyph`, and `under_player_item_glyph_cleared`.
- Worker envelope `runtime_ready` is consumed by `WorkerRuntimeBridge`; engine runtime events include `runtime_error` and `runtime_terminated`.

## Runtime Command Contract

- `send_input`
- `send_input_sequence`
- `send_mouse_input`
- `request_tile_update`
- `request_area_update`
- `request_runtime_globals_snapshot`
- `set_logging`

## WASM Pointer Contract

- Pointer contracts and validation live in `src/runtime/local/abi/`; callback bodies live with their domain owners. `LocalNetHackRuntime.handleUICallback` validates the contract before dispatch. Subsystem boundaries do not change WASM pointers, callback signatures, or command identifiers.
- NetHack 5.0 is the only runtime. `NethackRuntimeVersion` in `src/runtime/types.ts` is the single literal `"5.0"`; it stays in save metadata, handshakes and function signatures. NetHack 3.6.7 and Slash'EM were removed: a stored or requested value naming them is treated as unknown (save metadata, imports) or starts NetHack 5.0 (`RuntimeAssets.normalizeRuntimeVersion`). Saves made with them stay in their own IndexedDB databases and are not opened.
- The pointer ABI tag is defined by `vite.config.ts`: `VITE_NH3D_WASM_5_POINTER_ABI_TAG`.
- Use the callback/struct layout contract and validate shapes before reading memory. Do not scan arbitrary heap memory or silently replace unresolved command identifiers with guessed indices.
- The tracked map extension uses `monsterId=0` for the player; positive ids identify monsters. Preserve that identity through engine tile/entity presentation.
- See [pointer ABI troubleshooting](../../docs/pointer-abi-troubleshooting.md) for callback formats and command-table diagnostics, and [world/runtime flows](../../docs/engine-world-runtime.md) for the engine receivers.

## High-Risk Zones

- Async input state in runtime: `activeInputRequest`, `awaitingQuestionInput`, `pendingTextRequest`, `pendingExtendedCommandRequest`, `pendingMenuSelection`.
- Position state: `positionInputModeActive` in `src/game/engine/input/position-selection.ts`; runtime far-look state `farLookMode`, `farLookOrigin`, and `pendingLookMenuFarLookArm` belongs to `src/runtime/local/input/position-selection.ts`.
- Tile classification: `src/game/glyphs/behavior.ts`, `src/game/glyphs/registry.ts`, `src/game/engine/world/world-classification.ts`, and `updateTile` in `src/game/engine/rendering/tile-rendering.ts`.
- Generated catalogs (fallback/reference data): `src/game/glyphs/glyph-catalog.5.generated.ts`, `src/game/tilesets.generated.ts`, `src/game/helpers/startup-character-rulesets.generated.ts`. `src/game/vulture/legacy-tile-identities.ts` is fixed data, not generated.
- Update flow: `src/update/*` plus the UI in `src/ui/app/updates/`.
- Startup options and checkpoint recovery: `src/runtime/startup-init-options.ts`, `src/runtime/runtime-capabilities.ts`, and `src/storage/client-options-storage.ts`.


## Direct Quest WebXR proof

- `src/game/engine/rendering/webxr-presentation.ts` and `webxr-rig.ts`: original Three.js scene rendered through WebXR; camera-space conversion, tabletop/FPS placement, lifecycle and restoration.
- `src/game/engine/rendering/scaled-camera-sprites.ts` and `frame-time.ts`: sprite view-scale correction and the common game-effect clock during XR.
- `src/quest/webxr/`: in-game XR entry/settings, controller routing, and the wired HTML pane.
- `src/quest/webxr/html-ui-panel.ts` and `dom-pointer.ts`: world-anchored pane and live DOM picking/capture for native and wired VR. The native host consumes the same pose through the bounded `/__xr/table-ui` endpoint.
- `src/quest/webxr/board-tilt.ts` and `overlay-material.ts`: board pitch handle, backing-surface picking, and exemption of tracking-space UI/pointers from dungeon clipping.
- `scripts/quest/webxr/`: isolated Chrome wired host, pinned Wolvic/Gecko patches, custom GeckoView build and Maven staging, and verified standalone APK packaging.
- `quest/webxr/host/`: bundled asset host code injected into the owned Wolvic checkout.
- `quest/runtime/`: ignored external runtime checkout and native build dependencies.
- `BuildQuestWebXrApk.bat`: separate fully bundled WebXR proof workflow; dependency preflight precedes build work.
- `docs/quest-webxr-runtime.md`: authoritative proof setup and validation limits. The earlier Meta Spatial scene mirror is not the architecture for new VR world work.

The engine uses `renderer.setAnimationLoop` for both regular browser and WebXR frames. Keep XR session setup after engine assembly/UI initialization, and keep the source world/materials intact. The HTML compositor is the host-specific integration; do not reintroduce a native reconstruction of Three.js geometry.

- `src/quest/webxr/native-pointer-bridge.ts`: normalized DOM hit regions and per-hand world hit distance/normal snapshots. Wolvic owns the APK pointer and native UI events throughout; Three.js remains the single game-world renderer.

- `src/quest/webxr/table-ui-layout.ts` and `quest/webxr/host/GameUiPanels.h`: source UI crops, native table-attached quads, and mapping cropped hits back to the original DOM. One browser surface and one game instance are retained.
- `src/quest/webxr/controller-gestures.ts`: snap-turn neutral latch and RT tap/hold disambiguation. Existing engine owners execute run and context actions.
