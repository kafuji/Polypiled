# ブラウザなしの MCP（自動プレイ・テスト用）

2026-11-26。H1 を実装。

ブラウザを使わずに Polypiled を動かす MCP サーバーと、同じ仕組みを使うテスト用のクライアント。
ゲームは本物のランタイム（`LocalNetHackRuntime`）と本体（`public/nethack-5.wasm`）を Node のワーカースレッドで動かす。
UI は通さず、本体が出す構造化された情報（知識フレーム、持ち物 JSON、glance）と表示中のマップから観測を組み立てる。

ブラウザのタブにつなぐ旧版は [mcp-prototype.md](mcp-prototype.md)。

## 使い方

MCP クライアントに stdio サーバーとして登録する。トークンや開発サーバーは要らない。

```powershell
claude mcp add polypiled -- node scripts/mcp/headless-server.mjs
```

`npm run mcp:headless` でも起動できる。作業フォルダはリポジトリの直下にする。`public/` の本体を読むので、本体を差し替えたらサーバーを起動し直す。

| ツール | 内容 |
| --- | --- |
| `new_game` | 新しいゲーム。`seed`（0〜35999）、`role`/`race`/`gender`/`align`（4つそろえて指定、なければランダム）、`playmode`（`normal`/`explore`/`debug`）、`options`（NetHack のオプション） |
| `observe` | ターン、開いているプロンプト、主人公の位置、階層、ステータス、未読のメッセージ、見えているモンスター（名前つき）、足元、マップ |
| `act` | 1つ行動し、次に入力を待つまで待ってから、使ったターン数・出たメッセージ・次のプロンプト・ステータスの変化を返す |
| `inventory` | 持ち物（o_id、文字、名前、分類、数、分かっている祝福・呪い、強化値、充填数、装備中）、重量と容量、足元の物。いつも最新 |
| `end_game` | ゲームを終える |

`act` は次のどれか1つを取る。

| 指定 | 使う場面 | 送るもの |
| --- | --- | --- |
| `move`（+ `count`） | コマンド、方向、位置の選択 | 方向（`n` `ne` … `up` `down` `self`）。`count` は繰り返し |
| `keys` | どこでも | 生のキー。1文字、`Enter`、`Escape`、`^x`（Ctrl）、`M-x`（Meta） |
| `extended` | コマンド | 拡張コマンド名（`pray`、`loot` …） |
| `answer` | y/n、方向、位置 | 1キー |
| `select` | メニュー | プロンプトの `items[].index`。`prompt.multi` のときだけ複数。`count` で個数 |
| `text` | 文字入力 | 文字列（255 文字まで） |
| `dismiss` | 情報、`--More--` は Enter、ほかは Escape | |

プロンプトの種類（`prompt.kind`）: `command`、`more`、`yn`、`direction`、`menu`、`text`、`info`、`position`、`game_over`、`none`。

マップは表示中の文字そのまま。行の先頭が y、`ruler` が x の一の位。モンスターの文字なのに `monsters` にないものは像か、記憶に残った姿。

## 決めていること

- **再現性**: 本体は乱数の種を時刻から作る（WASM 版には `DEV_RANDOM` がなく、`time() * getpid()` を使う。`getpid()` は一定）。
  そこで時計を止め、`seed` は決まった日（2026-01-10、満月・新月・13 日の金曜日ではない日の昼間、UTC）の秒として渡す。
  同じ `seed` と同じ行動なら同じゲームになる。本体に種を直接渡す口は H2 で足す。
- **固定のオプション**: `!tutorial`、`number_pad:0`、`!autopickup`、`!legacy`。`options` で上書きできる（`number_pad` は除く）。
  アプリの起動設定に載っていないオプションは無視される。
- **デバッグモード**: 本体が `wizard` という名前だけに許すので、`playmode: "debug"` では名前が `wizard` になる。
- **1スレッド1局**: ランタイムは状態を `globalThis` に置き、本体どうしがコールバックを共有する。
  同じスレッドで2局目を始めると Asyncify の再入になるので `startNodeRuntime` が拒む。ゲームごとにワーカースレッドを使う。
- **終わらせ方**: ブラウザ版の終了処理は入力待ちを解放して本体を最後まで回すが、Node の1スレッドでは打ち切られた入力で本体が回り続けてイベントループが止まる。
  ここでは本体を入力待ちのまま捨て、ワーカーごと終了する。
- **セーブ**: IndexedDB がないので、セーブは本体のメモリ上のファイルにだけ残る（ゲームを終えると消える）。
- **完了の判定**: 行動のあと、答えた入力待ちが閉じるか、送ったキーがすべて読まれて静かになったら、次の入力待ちが開いて2回のイベントループのあいだ何も起きないまで待つ。
  メニューの中で項目を切り替えるだけのキーは入力待ちを閉じないので、250 ms 静かなら完了とみなす。

## 構成

| 場所 | 役割 |
| --- | --- |
| [src/headless/node-runtime.ts](../src/headless/node-runtime.ts) | Node で本体を読み込む（`RuntimeAssets` の差し替え）、時計と時間帯の固定、1スレッド1局 |
| [src/headless/agent-session.ts](../src/headless/agent-session.ts) | ランタイムのイベントから観測を組み立てる。プロンプトの判定、行動から入力への変換、一段落までの待ち |
| [src/headless/headless-game.ts](../src/headless/headless-game.ts) | 1局を始めて操作する（スレッド内） |
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

本物の本体で、再現性、最初の観測、ターンとメッセージ、デバッグモードの願い・メニュー・個数を指定した拾い上げ、y/n の質問を確かめる（2 秒ほど）。
`src/headless/agent-session.test.ts` は偽のイベントでの単体テストで、`npm test` に含まれる。

テストを書くときは `startHeadlessGame()` でゲームを起こし、`act()` の結果を確かめる。

```js
const { game } = await startHeadlessGame({ seed: 5, playmode: 'debug', role: 'valkyrie', race: 'human', gender: 'female', align: 'neutral' });
await game.act({ keys: ['^w'] });
const result = await game.act({ text: '3 rocks' });
assert.ok(result.messages.some(message => /3 rocks/.test(message.text)));
await game.close();
```

## 今後（H2〜H4）

- H2: 本体に足す。プロンプトの型（`getobj` の選べる文字、メニューの選び方）、一段落の印、メッセージの通し番号、種を指定する口、
  変化がなくてもターンを知らせる知識フレーム（今はステータス行の時間を使っている）。
- H3: ゲーム状態のスナップショットと分岐、デバッグモードで場面を作る補助、テストでの見えない情報の観測（デバッグモードのみ）。
- H4: ブラウザ版 MCP（`scripts/mcp/server.mjs`、`src/automation`）を外す。
