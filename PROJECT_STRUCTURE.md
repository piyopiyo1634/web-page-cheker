REV: 2026-03-16T02:30:52+09:00

# PROJECT_STRUCTURE

## 1. Project Overview

このプロジェクトは、複数のWebページの状態変化や価格情報を定期監視し、変化があればスナップショット更新や通知を行うための小規模な監視自動化リポジトリである。実装は主に GitHub Actions 上で動き、ページ取得・正規化・差分比較・通知、または Playwright による動的ページ解析を行う。

- 主な用途
  - Burger King の公開ページを正規化して差分監視
  - 特定イベントページのHTML差分監視
  - 東京ディズニーリゾートのホテル価格監視
- 技術スタック
  - Node.js 22
  - JavaScript ES Modules
  - GitHub Actions
  - `node-fetch`
  - `html-minifier-terser`
  - `cheerio`
  - `playwright`
  - `curl` / `diff` / `git` / LINE Messaging API

## 2. Folder Structure

```text
/
├── .git/                  # Git 管理情報
├── .github/               # GitHub 関連設定
│   └── workflows/         # 定期実行・通知用の GitHub Actions ワークフロー
├── snapshots/             # 比較用のHTMLスナップショット保存先
├── tdr-price-checker/     # Disney ホテル価格監視用の独立した Node スクリプト群
├── normalize_html.js      # HTML正規化ユーティリティ
├── package.json           # ルート側の依存関係定義
└── PROJECT_STRUCTURE.md   # 本ドキュメント
```

### フォルダごとの役割

- `.git/`
  - 履歴、ブランチ、コミットなどの Git 管理データを保持する。
- `.github/`
  - GitHub Actions を含むリポジトリ運用設定を保持する。
- `.github/workflows/`
  - 監視ジョブのスケジュール定義、セットアップ、比較、通知処理を実行する YAML を配置している。
- `snapshots/`
  - 前回取得したHTMLの基準値を保存する。差分検出の比較元として使われる。
- `tdr-price-checker/`
  - ルートとは別依存で Playwright を使う監視機能を分離している。Disney予約ページの解析に特化したサブモジュールである。

## 3. Key Files

| ファイル名 | 場所 | 役割 |
| --- | --- | --- |
| `package.json` | `/package.json` | ルート監視処理で使う Node 依存関係を定義する。 |
| `normalize_html.js` | `/normalize_html.js` | URL からHTMLを取得し、差分比較しやすい形に正規化して標準出力へ出す。 |
| `cheker-safe.yml` | `/.github/workflows/cheker-safe.yml` | Burger King ページを定期取得し、正規化後の差分を比較して必要時に LINE 通知する。 |
| `Rtokyo.yml` | `/.github/workflows/Rtokyo.yml` | イベントページを `curl` で取得し、HTML差分を検知して通知する。 |
| `tdr-price-checker.yml` | `/.github/workflows/tdr-price-checker.yml` | Playwright ベースの価格監視ジョブを定期実行する。 |
| `last_test.html` | `/snapshots/last_test.html` | Burger King 監視の比較基準スナップショット。 |
| `event_last_test.html` | `/snapshots/event_last_test.html` | イベント監視の比較基準スナップショット。 |
| `package.json` | `/tdr-price-checker/package.json` | Disney 価格監視サブモジュール用の依存関係を定義する。 |
| `check_disney_price.js` | `/tdr-price-checker/check_disney_price.js` | 動的ページから在庫有無と価格を抽出し、閾値判定する。 |

## 4. File Dependency Map

### メインエントリポイント

- GitHub Actions の各ワークフローが実行上の入口である。
  - `/.github/workflows/cheker-safe.yml`
  - `/.github/workflows/Rtokyo.yml`
  - `/.github/workflows/tdr-price-checker.yml`
- Node スクリプトとしての入口
  - `/normalize_html.js`
  - `/tdr-price-checker/check_disney_price.js`

### 主要依存関係

```text
cheker-safe.yml
  -> /package.json
  -> /normalize_html.js
     -> node-fetch
     -> html-minifier-terser
     -> cheerio
  -> /snapshots/last_test.html
  -> LINE Messaging API

Rtokyo.yml
  -> curl
  -> /snapshots/event_last_test.html
  -> LINE Messaging API

tdr-price-checker.yml
  -> /tdr-price-checker/package.json
  -> /tdr-price-checker/check_disney_price.js
     -> playwright
  -> Disney 予約サイト
```

### import / require 関係

- `/normalize_html.js`
  - `import fetch from "node-fetch"`
  - `import { minify } from "html-minifier-terser"`
  - `import * as cheerio from "cheerio"`
- `/tdr-price-checker/check_disney_price.js`
  - `import { chromium } from "playwright"`

### 補足

- ルートの JavaScript と `tdr-price-checker/` 配下の JavaScript は、相互 import していない。
- 依存は「ワークフロー -> スクリプト -> 外部ライブラリ / 外部サービス」という一方向で、ローカルモジュール間の複雑な結合はない。

## 5. Data Flow

### 1. ルートのページ差分監視

1. GitHub Actions が cron または手動で起動する。
2. 対象ページを取得する。
   - Burger King 監視では `normalize_html.js` が URL を取得する。
   - イベント監視ではワークフロー内で `curl` を直接実行する。
3. 必要に応じて HTML を正規化する。
   - コメント削除
   - 空白圧縮
   - `head`、`script`、`style`、`noscript` 除去
   - 一部 `meta`、タイムスタンプ、追跡属性の除去またはマスク
4. 現在HTMLと `snapshots/` 内の前回HTMLを比較する。
5. 差分があればスナップショットを更新して Git へコミット・push する。
6. LINE Messaging API を呼び出して通知する。

### 2. Disney 価格監視

1. `tdr-price-checker.yml` が定期実行される。
2. `tdr-price-checker/` で依存をインストールし、Playwright の Chromium を準備する。
3. `check_disney_price.js` が `TARGET_URL` と `THRESHOLD_YEN` を環境変数から読む。
4. Playwright で予約ページを開き、在庫なし文言または価格記号の出現を待つ。
5. ページ本文から価格を抽出する。
6. 閾値未満なら `CHEAPER_THAN_THRESHOLD`、それ以外なら `NOT_CHEAPER` を出力する。
7. タイムアウトや価格抽出失敗時はスクリーンショットを保存して異常終了扱いにする。

### 外部API・外部サービス

- Burger King 公開ページ
- Randonneurs Tokyo のイベントページ
- 東京ディズニーリゾート予約サイト
- LINE Messaging API
- GitHub Actions 実行環境

### データ保存

- 永続保存される主データは `snapshots/*.html` の比較用HTMLである。
- データベースは使っていない。

## 6. Notes & Observations

- 循環依存
  - JavaScript モジュール間の循環依存は見当たらない。
- 未使用ファイル
  - 明確な未使用ファイルは少ないが、`snapshots/` 内の HTML は実行時成果物であり、アプリ本体コードではない。
- 構成上の特徴
  - ルート監視と `tdr-price-checker/` が別 `package.json` を持つため、依存分離は明確である。
  - ただし monorepo 管理というよりは、単一リポジトリ内に用途別スクリプトを並べた軽量構成である。
- 気になる点
  - ルート `package.json` に scripts 定義がなく、ローカル実行手順が暗黙的である。
  - YAML ファイル名 `cheker-safe.yml` は `checker` のタイプミスに見える。
  - ワークフロー内コメントや正規表現周辺に文字化けがあり、保守性を下げている。
  - `Rtokyo.yml` は HTML 正規化を行わず生HTML比較なので、些細な変更でも検知しやすい。
  - `check_disney_price.js` は通知処理を未実装コメントで残しており、現状は判定ログ出力までで完結している。
  - `tdr-price-checker.yml` の依存インストール手順はデバッグ出力が多く、本番運用にはやや冗長である。
