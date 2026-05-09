# Secret Rotation Procedure

> 半期に一度 (4月 / 10月) に rotate するのを目安にしています。
> 漏洩疑いがあるときは即時 rotate してください。

## 一覧

| Secret | 場所 | 取得元 | 影響範囲 |
|---|---|---|---|
| `BREVO_API_KEY` | Cloudflare Pages > Settings > Variables (Secret) | Brevo > SMTP & API > API Keys | 全自動返信メール送信 |
| `TURNSTILE_SECRET_KEY` | 同上 | Cloudflare > Turnstile > Site detail | フォーム CAPTCHA verify |
| `ICEN_NUMBER_SALT` (任意) | 同上 | 自分で生成 (`openssl rand -hex 32`) | 申請番号の HMAC 化 |
| `GEMINI_API_KEY` | サーバ `${ICEN_ENV_FILE:-~/.icen.env}` | Google AI Studio > API Keys | 活動報告/緊急声明の自動生成 |

## 手順

### Brevo API Key

1. <https://app.brevo.com/settings/keys/api> を開く
2. 既存キー (`natto-bokumetsu`) の「⋯」→ **Delete** (もしくは無効化)
3. 「**Generate a new API key**」 → 名前: `natto-bokumetsu` → 生成 → **値をコピー**
4. CF Pages > Settings > Variables and Secrets > `BREVO_API_KEY` の編集 → 新値を貼り付け → Save
5. Deployments > 最新の「⋯」→ **Retry deployment**
6. 検証: `/api/health` 200 / 試しにフォーム送信して受理メール届くか

### Turnstile Secret Key

1. CF ダッシュ > Turnstile > サイト一覧 > 該当サイト
2. **Settings** タブ > **Rotate secret key** (Site key は変えなくてOK)
3. 新しい Secret Key をコピー
4. CF Pages > `TURNSTILE_SECRET_KEY` を更新 → Save
5. Retry deployment
6. 検証: ブラウザでフォーム送信 → CAPTCHA 完了 → 200。token なしの直 POST が 403 になること

### ICEN_NUMBER_SALT

回さない方が良い (回すと**同じメアド**でも申請番号が変わってしまうため)。
salt を変える場合は事前に KV の `email:*` を全件 export → 新 salt で再ハッシュ → 再 import を計画する。

### Gemini API Key

1. <https://aistudio.google.com/apikey> で旧キー削除 → 新規発行
2. サーバ: `nano "${ICEN_ENV_FILE:-$HOME/.icen.env}"` で `GEMINI_API_KEY=...` を更新
3. cron が次に走る時 (or `bash <repo>/scripts/update.sh` で手動) 検証

## チェック表 (毎回これを埋めてコミット)

```
date:        2026-MM-DD
who:         (operator handle)
brevo:       rotated [Y/N]
turnstile:   rotated [Y/N]
gemini:      rotated [Y/N]
notes:       (incident? routine? etc.)
```
