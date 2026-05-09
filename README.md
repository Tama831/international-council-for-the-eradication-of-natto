# 国際納豆撲滅協議会 / International Council for the Eradication of Natto (ICEN)

> **※本リポジトリは架空団体のパロディサイトです。**
> 国際納豆撲滅協議会という団体は実在しません。納豆は日本が世界に誇る伝統的な発酵食品で、優れた栄養価を持ちます。本サイトは納豆を愛する方々を否定する意図を一切持たず、ユーモアと言葉遊びを目的としたフィクション作品です。茨城県の皆様には心からの敬意と感謝を捧げます。

「**粘り、断つべし**」— 1972年京都密約より半世紀。我々は粘る敵に、粘り強く抗う。

🌐 **Live**: <https://tama831.github.io/international-council-for-the-eradication-of-natto/>

---

## 構成

```
.
├── index.html              # メインページ (HTML/CSS only)
├── data/
│   ├── activities.json     # 活動報告タイムライン
│   └── bulletins.json      # 緊急電光ニュース ticker
├── scripts/
│   ├── render.py           # data/*.json → index.html (in-place)
│   ├── generate_activity.py # Gemini で活動報告を1件生成 → activities.json に追記
│   ├── generate_bulletin.py # Gemini で緊急声明を1件生成 → bulletins.json をローテ
│   └── update.sh           # 生成 → 描画 → commit & push の orchestrator
└── README.md
```

## 技術スタック

- **HTML / CSS のみ** (Vanilla, ノービルド)
- **Google Fonts**: しっぽり明朝B1 / Noto Serif JP / DM Serif Display / JetBrains Mono
- **GitHub Pages** (static hosting)
- **Gemini API** (活動報告の自動生成)
- **Python 3 (stdlib のみ)** — render / generate スクリプト

## ローカル確認

```bash
cd <repo>
python3 -m http.server 8000
# → http://localhost:8000 で確認
```

## 自動更新パイプライン

> 「適当な活動報告を不定期にそれっぽく生成して、反映」させるための仕組み。

```
[cron] → update.sh
           ├── scheduler.py         (今日は何をするか判定)
           │     ├─ "annual"   = 3月第3日曜+3日後の水曜 (公式コミュニケ発表日)
           │     ├─ "regular"  = 直近活動報告から23日経過
           │     └─ "skip"     = それ以外 (低確率で ticker のみ更新)
           ├── generate_activity.py (Gemini が新しい活動報告を1件生成)
           │     --mode=annual  → 第NN回京都密会 (3日間討議の総括)
           │     --mode=regular → 通常の通牒・勧告・声明など
           ├── generate_bulletin.py (緊急声明 ticker をローテーション)
           ├── render.py            (data/*.json → index.html を書き換え)
           └── git add + commit + push
                  ↓
             GitHub Pages 自動再ビルド (~30秒)
```

### スケジュールの考え方

- **京都密会 (年次)**: 3月第3**日曜日**から3日間 (日・月・火) 開催。公式コミュニケは
  その**翌々日(水)**に発表される。例: 2026年は 03/15(日)〜03/17(火) 開催 → 03/18(水) 公表。
- **通常の活動報告**: 最終投稿から23日おきに1件生成。京都密会と独立してカウント。

### 環境変数

```bash
export GEMINI_API_KEY="..."        # 必須 (Gemini 2.5 Flash 使用)
```

`update.sh` は冒頭で `${ICEN_ENV_FILE:-$HOME/.icen.env}` を source する。
このファイルに `GEMINI_API_KEY=...` を 1 行書いておけば OK。

### Cron 例

scheduler.py が今日 generate するか判定するので、**毎日1回叩いてOK**。

```cron
# 毎朝 9:00 (server local time) に scheduler を回す。今日が23日サイクル日
# or 3月第3日曜+3日後の水曜なら発火、それ以外は skip 判定 (たまに ticker だけローテ)。
0 9 * * * cd ~/icen && bash scripts/update.sh >> /var/log/icen.log 2>&1
```

ワンライナー登録:
```bash
(crontab -l 2>/dev/null; echo "0 9 * * * cd ~/icen && bash scripts/update.sh >> /var/log/icen.log 2>&1") | crontab -
```

### 手動実行

```bash
cd <repo>
bash scripts/update.sh
```

### 生成だけ・描画だけしたいとき

```bash
python3 scripts/generate_activity.py   # 1件追記
python3 scripts/generate_bulletin.py   # 1件ローテ
python3 scripts/render.py              # index.html を data から再描画
```

## 編集の入口

- **見た目の変更**: `index.html` の `<style>` ブロック
- **本文・コピー変更**: `index.html` 直接編集 (活動報告・緊急声明以外)
- **活動報告 / 緊急声明**: `data/*.json` 編集 → `python3 scripts/render.py` → commit
  - **直接 index.html の `<!-- AUTO:*:START/END -->` の中をいじらない** (次回 render で消える)

## 入会申請バックエンド (Phase 3 / Cloudflare Pages Functions)

`functions/api/*.ts` が Cloudflare Pages 上で動く API。Hetzner には**何も置かない**。

- `POST /api/apply` — JSON フォームを受信
- `GET /api/health` — 死活確認
- **永続化**: Workers KV (`ICEN_KV`) に **email + 申請番号 + 初回時刻 + 重複回数** のみ
  (氏名・居住地・嫌悪歴等はメール送信のみに使用、保存しない)
- **メール送信**: Brevo Transactional Email API (無料 300通/日)
- **初回**: 受理通知 + 30秒沈黙課題の指示
- **2回目以降**: 「既に受理済み・初回申請日より14日以内に課題提出を」

### デプロイ手順 (一度きり)

#### A. Brevo (メール送信業者) を準備
1. <https://www.brevo.com/> に sign up (無料、メール認証)
2. ダッシュボード右上の「**SMTP & API**」→「**API キー**」→ 新規作成 → コピー
3. 「**Senders & IP**」→「**Senders**」→ 自分の送信元アドレス (ICEN 事務局として使う Gmail 等) を追加
   → 受信した認証メールのリンクをクリック
   - これをやらないと「送信元未承認」エラーで届かない

#### B. Cloudflare Pages にデプロイ
1. <https://dash.cloudflare.com/> に sign up
2. 「**Workers & Pages**」→「**Create**」→「**Pages**」タブ →「**Connect to Git**」
3. GitHub 認可 → リポジトリ `Tama831/international-council-for-the-eradication-of-natto` を選択
4. Build settings:
   - Framework preset: **None**
   - Build command: (空欄)
   - Build output directory: `/`
   - Root directory: (空欄)
5. 「**Save and Deploy**」 → 30秒〜1分でビルド完了 → `<project>.pages.dev` URL が発行される

#### C. KV namespace を作る + バインド
1. Project の「**Settings**」→「**Bindings**」→「**KV Namespace bindings**」→ Add binding
2. Variable name: `ICEN_KV`
3. KV namespace: 「**Create new namespace**」→ 名前は `icen` とか何でも
4. Save

#### D. 環境変数
1. 同じ「**Bindings**」→「**Environment variables**」→ Add variable
2. `BREVO_API_KEY` = (A.2 でコピーした値) — 「**Type: Secret**」を選ぶ
3. (Optional) `ICEN_SENDER_EMAIL` = 別アドレスを使うなら指定
4. Save → **再デプロイ**ボタン (or 次の git push) で反映

#### E. メタタグを CF URL に書き換え
```html
<!-- index.html の冒頭 -->
<meta name="icen-api" content="https://<project>.pages.dev/api" />
```
※ pages.dev でアクセスする限りは meta 空のままでも `/api` で動くが、github.io 経由で
   フォームを使えるようにしたい場合は CF URL を入れる。

```bash
# meta 編集後
git add index.html && git commit -m "Wire form to CF Pages API" && git push
# → CF Pages も github.io も同時に最新化される
```

### 自動返信の編集

`functions/api/_templates.ts` の `REPLY_FIRST` / `REPLY_REPEAT` 文字列を直接編集 → push
→ CF Pages が自動再デプロイ → 即反映。プレースホルダ: `{{app_no}}` のみ。

### Legacy (Hetzner FastAPI 版)

`server/` と `infra/` には Phase 3 検討初期に作った FastAPI + nginx 版が残っている。
agent-team prod への影響を避けるため CF Pages 版に切り替えたので、現在は **未使用**。
将来 Hetzner で動かしたくなった場合の参考として残置 (削除しても構わない)。

## プライバシー / セキュリティ

### 保存しているデータ
- Workers KV (`ICEN_KV`) に **email + 申請番号 + first_at + count + last_seen** のみ
- 氏名・居住地・嫌悪歴等の他のフォーム項目は**返信メール送信後すぐに破棄** (永続化しない)
- 削除請求があれば手動で KV から該当 key を削除

ユーザ向け文面は [`privacy.html`](privacy.html) を参照。

### 現状の対策 (Tier 0+1+2 全実装 + 強化全7項)

| 対策 | 状態 |
|---|---|
| HTTPS | ✅ Cloudflare が自動 |
| KV 暗号化 (at rest) | ✅ Cloudflare 仕様 |
| API キー管理 | ✅ Secret として CF Pages 側で保管 |
| CORS allowlist | ✅ tama831.github.io と natto-5hv.pages.dev のみ |
| **CSP / セキュリティヘッダー** | ✅ `_headers` で CSP + X-Frame-Options + HSTS + Referrer-Policy + Permissions-Policy |
| Honeypot field | ✅ `affiliation` 欄 (bot トラップ) |
| 入力長制限 / email 形式 | ✅ 各フィールド ≤200文字 |
| 最小データ保存 | ✅ email + 申請番号 + 時刻のみ |
| Per-IP レート制限 | ✅ apply 5/h, delete-request 5/h, confirm-* 20/h |
| **per-recipient メール送信制限** | ✅ 同一受信者 5通/日 |
| **使い捨てメールドメイン拒否** | ✅ 30+ ドメイン (mailinator/yopmail/temp-mail等) を embed |
| **MX レコード DNS チェック** | ✅ DNS-over-HTTPS で MX/A 確認、24h cache |
| **double opt-in (申請に確認メール)** | ✅ apply→確認メール→24h 有効 token→confirm-apply→正式受理 |
| **トークン制 削除請求** | ✅ /delete-request→確認メール→24h token→/confirm-delete |
| **申請番号 HMAC 化** | ✅ ICEN-A-2026-XXXX (XXXX = HMAC-SHA256(salt, email) 上位2バイト hex) |
| Turnstile (CAPTCHA) | ✅ 有効 (`TURNSTILE_SECRET_KEY` 設定済) |
| **secret rotate ドキュメント** | ✅ [docs/secret-rotation.md](docs/secret-rotation.md) |

### Cloudflare Pages 側の env vars 一覧

| 変数 | Type | 用途 | 必須 |
|---|---|---|---|
| `BREVO_API_KEY` | Secret | Brevo Transactional API | ✅ |
| `TURNSTILE_SECRET_KEY` | Secret | Turnstile siteverify | ✅ (有効化後) |
| `ICEN_NUMBER_SALT` | Secret | 申請番号 HMAC 用 salt (`openssl rand -hex 32`) | △ (未設定なら旧seq fallback) |
| `ICEN_SENDER_EMAIL` | Plaintext | 送信元アドレス | ✅ |
| `ICEN_SENDER_NAME` | Plaintext | 送信元表示名 | △ |
| `ICEN_PUBLIC_BASE_URL` | Plaintext | 確認リンクの host (default: https://natto-5hv.pages.dev) | △ |
| `ICEN_ALERT_EMAIL` | Plaintext | abuse 通知の宛先 (未設定なら通知 skip) | △ |
| `ICEN_ADMIN_KEY` | Secret | X 自動投稿エンドポイントの shared secret。Hetzner cron 側 `.env` にも同値を設定 | △ (X 自動投稿時) |
| `X_API_KEY` | Secret | X Developer Portal の API Key (Consumer Key) | △ (X 自動投稿時) |
| `X_API_KEY_SECRET` | Secret | X API Key Secret (Consumer Secret) | △ (X 自動投稿時) |
| `X_ACCESS_TOKEN` | Secret | X User Access Token | △ (X 自動投稿時) |
| `X_ACCESS_TOKEN_SECRET` | Secret | X User Access Token Secret | △ (X 自動投稿時) |

### double opt-in フロー

```
1. ユーザがフォーム送信 → POST /api/apply
   ├─ 既に確定済 → REPLY_REPEAT 即送信 (phase=repeat)
   └─ 未登録 → 24h 有効 token 発行 → REPLY_CONFIRM_APPLY 送信 (phase=confirmation-pending)
                                                                ↓
                       ユーザがメール内のリンクをクリック
                                                                ↓
2. /confirm-apply.html?t=TOKEN → POST /api/confirm-apply
   ├─ 有効 → 申請番号 (HMAC) 発番 → KV 書込 → REPLY_FIRST 送信 (phase=first)
   └─ 期限切れ/不正 → 404
```

### まだ未実装の選択肢 (low priority)

- **Cloudflare Bot Fight Mode** — Custom Domain 必須なので保留
- **CF Workers Logpush** — abuse forensics 用の構造化ログ
- **インラインスタイル/スクリプトを外部化して CSP 厳格化** — 現状 `'unsafe-inline'` 許可中

## 公開フロー

`master` への push で Cloudflare Pages が自動再デプロイ (Production)、GitHub Pages もミラー再ビルド。手動デプロイ不要。

## ライセンス・免責 (詳細)

本サイトはユーモアを目的としたパロディです。実在の人物・団体・地域・自治体とは一切関係ありません。

- 納豆は健康に良い伝統食品です
- 茨城県は素敵な県です (水戸納豆発祥の地への敬意)
- 上記5カ国 (仏伊韓伯墨) は実際には ICEN という協議会に加盟していません (存在しないので)
- 「ジャン=ピエール・ルセール」「宮川 透」等はすべて架空人物です

コードと文章は MIT ライセンス相当で自由に改変可。ただし類似のパロディを作る場合は、対象への敬意と免責文を必ず添えてください。

---

🍽 *NATTO IS DELICIOUS. THIS IS JUST A JOKE.*
