# ICEN Application API (server/) — ⚠️ LEGACY / UNUSED

> このディレクトリは Phase 3 検討初期に作った **Hetzner FastAPI + Gmail SMTP** 版。
> agent-team prod への影響を避けるため、本番運用は **Cloudflare Pages Functions** 版
> ([`functions/api/apply.ts`](../functions/api/apply.ts)) に切り替えました。
> このコードは現在 **どこにもデプロイされていません**。将来 Hetzner で動かしたい
> 場合のリファレンスとして残してあります。削除しても支障ありません。

---

# ICEN Application API (server/)

入会申請を受け取り、Gmail SMTP 経由で satirical 自動返信を送る FastAPI バックエンド。

## 仕様

- `POST /apply` — JSON ボディで申請受付。初回は受理通知、2回目以降は重複通知。
- `GET /health` — 死活確認。
- 永続化: `data/applications.json` に **email + 申請番号 + 初回時刻 + 重複回数** のみ。
  名前・居住地・嫌悪歴等は返信メール送信後に破棄(ストレージへ書かない)。
- 重複判定: email (大小無視・前後 strip) で同定。

## 必要な環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `GMAIL_USER` | △ | 送信元 Gmail アドレス (default: `ly.renum@gmail.com`) |
| `GMAIL_APP_PASSWORD` | **必須** | Gmail App Password ([作成方法](https://myaccount.google.com/apppasswords)) |
| `ICEN_FROM_NAME` | △ | 表示名 (default: `国際納豆撲滅協議会 事務局 / ICEN Secretariat`) |
| `ICEN_FROM_ADDR` | △ | From メールアドレス (default: `GMAIL_USER`) |
| `ICEN_DATA_DIR` | △ | applications.json 保存先 (default: `../data`) |

## ローカルテスト

```bash
cd /home/tama/projects/natto-eradication/server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

export GMAIL_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # 16桁
.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8731

# 別ターミナルで疎通テスト
curl -s http://127.0.0.1:8731/health

curl -s -X POST http://127.0.0.1:8731/apply \
  -H 'Content-Type: application/json' \
  -d '{
    "name":"宮川 透", "region":"京都府", "breakfast_main":"米",
    "hate_years": 10, "hate_reason":"匂", "signature":"宮川",
    "email":"your+test@gmail.com"
  }'
```

## 本番デプロイ (Hetzner)

`infra/systemd/icen-api.service` と `infra/nginx/icen-api.conf` を参照。

```bash
# 1. venv 作成 + deps
cd /home/tama/projects/natto-eradication/server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 2. App Password を /home/tama/ai-agent-team/.env に追記
echo 'GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx' >> /home/tama/ai-agent-team/.env

# 3. systemd 登録
sudo cp /home/tama/projects/natto-eradication/infra/systemd/icen-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now icen-api
sudo systemctl status icen-api

# 4. nginx (既存サイトに /icen/ ロケーション追加)
sudo cp /home/tama/projects/natto-eradication/infra/nginx/icen-api.conf /etc/nginx/snippets/
# 既存 server ブロックに  include snippets/icen-api.conf;  を追加
sudo nginx -t && sudo systemctl reload nginx

# 5. index.html の <meta name="icen-api"> を実 URL に書き換え → render → push
```

## テンプレート編集

返信文は `server/templates/*.txt` を直接編集すれば即反映 (再起動不要、ファイル毎リクエスト読み込み)。
