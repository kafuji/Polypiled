# ブラウザなしの MCP（自動プレイ・テスト用）

2026-11-26。

ブラウザを使わずに Polypiled を動かす MCP サーバーと、同じ仕組みを使うテスト用のクライアント。
ゲームは本物のランタイム（`LocalNetHackRuntime`）と本体（`public/nethack-5.wasm`）を Node のワーカースレッドで動かす。
UI は通さず、本体が出す構造化された情報（知識フレーム、持ち物 JSON、glance、コマンド入力待ちと位置選択の印）と表示中のマップから観測を組み立てる。

以前のブラウザのタブにつなぐ MCP（`scripts/mcp/server.mjs`、`src/automation`）は削除した。

## 使い方

MCP クライアントに stdio サーバーとして登録する。トークンや開発サーバーは要らない。

```powershell
claude mcp add polypiled -- node scripts/mcp/headless-server.mjs
```

`npm run mcp:headless` でも起動できる。作業フォルダはリポジトリの直下にする。`public/` の本体を読むので、本体を差し替えたらサーバーを起動し直す。

### ツール

| ツール | 内容 |
| --- | --- |
| `new_game` | ゲームを始め、`game`（`g1` など）と最初の観測を返す。同時に 8 つまで。`seed`（0〜4294967295）、`role`/`race`/`gender`/`align`（4つそろえて指定、なければランダム）、`playmode`（`normal`/`explore`/`debug`）、`options`（NetHack のオプション）。`snapshot` か `snapshot_file` を渡すと保存した時点の複製を始める |
| `list_games` | 動いているゲームと、それぞれの設定 |
| `observe` | ターン、開いているプロンプト、主人公の位置、階層、ステータス、未読のメッセージ、見えているモンスター（名前つき）、足元、マップ |
| `act` | 1つ行動し、次に入力を待つまで待ってから、使ったターン数・出たメッセージ・次のプロンプト・ステータスの変化を返す |
| `travel` | `_` で x, y まで歩く |
| `inventory` | 持ち物（o_id、文字、名前、分類、数、分かっている祝福・呪い、強化値、充填数、装備中）、重量と容量、足元の物（o_id つき）。いつも最新 |
| `snapshot` | 今の時点を保存する（設定とこれまでの全行動、指紋）。`file` を渡すと作業フォルダ内の `.json` にも書く |
| `reveal` | デバッグモードのみ。本当の地形、全モンスター、床の全物体（本当の名前）、罠、主人公の運・信仰・祈りの待ち時間・神の怒り・満腹度 |
| `debug` | デバッグモードのみ。`wish`（`text`）、`create_monster`（`text`）、`teleport`（`x`, `y`）、`level_teleport`（`level`：数か名前）、`map` |
| `end_game` | ゲームを終える |

ツールは `game` を省くと、最後に始めたゲームを対象にする。

### 行動（`act`）

次のどれか1つを取る。

| 指定 | 使う場面 | 内容 |
| --- | --- | --- |
| `move`（+ `count`） | コマンド、方向、位置の選択 | 方向（`n` `ne` … `up` `down` `self`）。`count` は繰り返し |
| `keys` | どこでも | 生のキー。1文字、`Enter`、`Escape`、`^x`（Ctrl）、`M-x`（Meta） |
| `extended` | コマンド | 拡張コマンド名（`pray`、`loot` …） |
| `answer` | y/n、方向、位置 | 1キー |
| `select` | メニュー | プロンプトの `items[].index`。`prompt.multi` のときだけ複数。`count` で個数 |
| `text` | 文字入力 | 文字列（255 文字まで） |
| `position` | 位置の選択 | `{x, y}`。カーソルを動かして選ぶ |
| `inventory` | コマンド | 持ち物の操作を丸ごと（`wear`/`takeoff`/`puton`/`remove`/`wield`/`quiver`/`alternate`/`swap`/`twoweapon`/`adjust` は文字で、`pickup`/`drop`/`loot` は o_id で）。確認は本体が自分で答える |
| `dismiss` | 情報、`--More--` は Enter、ほかは Escape | |

プロンプトの種類（`prompt.kind`）:

| 種類 | 意味 |
| --- | --- |
| `command` | 新しいコマンドを待っている（本体の `command_ready` の印がある入力待ち） |
| `key` | コマンドの途中で1キーを待っている（回数の入力中、前置キーのあとなど） |
| `more` | 窓を開かずに続きを待っている |
| `yn` | 質問。`choices` と `default` |
| `direction` | 方向 |
| `menu` | メニュー。`multi` が真なら複数選んで Enter |
| `text` | 文字入力 |
| `info` | 情報の窓 |
| `position` | 位置の選択（本体の getpos の開始から終了まで）。`cursor` は今のカーソル |
| `game_over` | ゲームが終わった。`gameOver` に `complete`、`deathMessage`、墓碑の `lines` が入る。以後の行動は失敗する |

マップは表示中の文字そのまま。行の先頭が y、`ruler` が x の一の位。モンスターの文字なのに `monsters` にないものは像か、記憶に残った姿。

## 本体（core）に足したもの

| 場所 | 内容 |
| --- | --- |
| `sys/libnh/libnhmain.c` `sys_random_seed()` | `globalThis.nh3dHeadless.seed` があればそれを種にする。弱い種として扱うので `reseed_random()` は種を変えない |
| `src/cmd.c` `parse()` | 画面を更新したあと `shim_command_ready`（ターン、主人公の x, y）を出す。次の入力待ちがコマンドの入力待ちだと分かる |
| `src/getpos.c` `getpos()` | 始まりと終わりに `shim_getpos`（1/0、カーソルの位置）を出す |
| `win/shim/nh3d_knowledge.c` `#nh3dinventory` | 要求 `reveal` で `shim_reveal` を出す（デバッグモードのみ）。乱数を使う関数は呼ばないので、出しても進行は変わらない。時間も使わない |

`reveal` の地形の文字: ` ` 岩、`|` `-` 壁、`#` 通路・木・鉄格子・流し、`.` 床・戸口・氷、`+` 閉じた扉、`'` 開いた扉、`S` 隠し扉、`C` 隠し通路、`<` `>` 階段・はしご、`{` 泉、`\` 玉座、`|` 墓、`_` 祭壇、`}` 水、`L` 溶岩、`~` 空気・雲。

ランタイムはこれらを `command_ready`、`getpos`、`reveal` のイベントにする。画面側は使わない（知らない種類のイベントは無視する）。

## 決めていること

- **再現性**: 種は本体に直接渡す。時計も止める（月の満ち欠け、13 日の金曜日、夜と真夜中に効くため）。止める日は 2026-01-10 の昼間、UTC で、満月・新月・金曜日ではない日。同じ設定と同じ行動なら同じゲームになる。
- **スナップショット**: 保存するのは設定と行動の列、それに「見えているもの」（ターン、プロンプト、主人公、階層、ステータス、マップ）の指紋。
  始めるときは行動を再生し、指紋が合わなければ失敗にする（違う本体で作ったものなど）。セーブファイルではないので読める JSON のままテストの材料にできる。
  再生には1手あたり数ミリ秒かかる。`reveal` も行動として記録する（`^A` で繰り返すコマンドに影響するため）。
- **固定のオプション**: `!tutorial`、`number_pad:0`、`!autopickup`、`!legacy`。`options` で上書きできる（`number_pad` は除く）。
  アプリの起動設定に載っていないオプションは無視される。
- **デバッグモード**: 本体が `wizard` という名前だけに許すので、`playmode: "debug"` では名前が `wizard` になる。
- **1スレッド1局**: ランタイムは状態を `globalThis` に置き、本体どうしがコールバックを共有する。
  同じスレッドで2局目を始めると Asyncify の再入になるので `startNodeRuntime` が拒む。ゲームごとにワーカースレッドを使う。
- **終わらせ方**: ブラウザ版の終了処理は入力待ちを解放して本体を最後まで回すが、Node の1スレッドでは打ち切られた入力で本体が回り続けてイベントループが止まる。
  ここでは本体を入力待ちのまま捨て、ワーカーごと終了する。
- **セーブ**: IndexedDB がないので、本体のセーブはメモリ上のファイルにだけ残る。続きから遊ぶにはスナップショットを使う。
- **ゲームの終わり**: 死亡のあとの質問（持ち物の識別、属性…ダンジョンの概観）に答え終えると、ランタイムが `game_over_complete` を出し、本体はそれ以上入力を求めない。
  セッションはそこでゲームを終わったものとし、プロンプトを `game_over` にする。
- **完了の判定**: 行動のあと、答えた入力待ちが閉じるか、送ったキーがすべて読まれて静かになったら、次の入力待ちが開いて2回のイベントループのあいだ何も起きないまで待つ。
  メニューの中で項目を切り替えるだけのキーは入力待ちを閉じないので、250 ms 静かなら完了とみなす。
- **位置の選択**: カーソルは getpos が最後に置いた位置（`map_cursor`）から、`hjklyubn`（1 マス）と `HJKLYUBN`（8 マス）で動かし、`.` で選ぶ。
  `@`（主人公へ）は使わない（farlook ではそこで選んだことになる）。カーソルを動かす間に本体が出す地点の説明（autodescribe）は、メッセージから省く。

## 構成

| 場所 | 役割 |
| --- | --- |
| [src/headless/node-runtime.ts](../src/headless/node-runtime.ts) | Node で本体を読み込む（`RuntimeAssets` の差し替え）、種、時計と時間帯の固定、1スレッド1局 |
| [src/headless/agent-session.ts](../src/headless/agent-session.ts) | ランタイムのイベントから観測を組み立てる。プロンプトの判定、行動から入力への変換、一段落までの待ち |
| [src/headless/headless-game.ts](../src/headless/headless-game.ts) | 1局を始めて操作する（スレッド内）。行動の記録、スナップショットと再生、デバッグ用の補助 |
| [src/headless/game-worker.ts](../src/headless/game-worker.ts) | ワーカースレッドの入口 |
| [scripts/headless/game-client.mjs](../scripts/headless/game-client.mjs) | ワーカーを esbuild でまとめ（初回のみ、0.1 秒ほど）、ゲームごとにワーカーを起こす |
| [scripts/mcp/headless-server.mjs](../scripts/mcp/headless-server.mjs) | MCP サーバー |

ワーカーの標準出力は捨てる（ランタイムのログが多く、stdio の MCP は標準出力を通信に使うため）。

`src/headless` は Node で動くので、`tsconfig.headless.json` で Node の型を足して検査する。アプリ側の `tsconfig.json` からは外してある。
esbuild と `@types/node` はほかのパッケージ経由で入っているものを使っている。

## テスト

```powershell
npm run test:headless
```

本物の本体で確かめる（4 秒ほど）。項目は次のとおり。

- 種による再現
- 最初の観測、ターンとメッセージ、コマンドの途中のキー
- メニュー（1つ選ぶ、個数つきで複数）、持ち物の操作、y/n
- 位置の選択（farlook と travel）
- スナップショットの再生と、指紋が合わないものの拒否
- デバッグモード（reveal、願い、モンスターの生成、テレポート、階層移動、地図）
- 死亡（`#quit`）から `game_over` まで
- MCP サーバー（複数のゲーム、スナップショットのファイル）

`src/headless/agent-session.test.ts` は偽のイベントでの単体テストで、`npm test` に含まれる。

Polypiled のルール変更（[rule-changes.md](rule-changes.md)）の回帰テストは `scripts/headless/rules.test.mjs` にある（`npm run test:rules`、並列で 2 秒ほど）。
CI のほか、本体のビルド（Build game core (WASM)）でも、できたばかりの本体に対して流す（`POLYPILED_CORE_DIR` で本体の場所を変えられる）。

ルールを変えたときのテストは、`startHeadlessGame()` で（必要ならデバッグモードで）場面を作り、`act()` の結果を確かめる。

```js
const { game } = await startHeadlessGame({ seed: 5, playmode: 'debug', role: 'valkyrie', race: 'human', gender: 'female', align: 'neutral' });
await game.wish('3 rocks');
const rocks = (await game.inventory()).items.find(item => /rocks/.test(item.name));
const dropped = await game.act({ inventory: { op: 'drop', items: [{ id: rocks.id }] } });
assert.ok(dropped.messages.some(message => /You drop 3 rocks/.test(message.text)));
await game.close();
```

場面をファイルに残すときは `snapshot()` の結果を JSON で保存し、`startHeadlessGame({ snapshot })` で始める。
