# Incident Playbook

> 問題が起きたら、深呼吸してこの文書を上から読む。慌てて消したり再起動しない。

## 共通の最初の一歩

1. **時刻と症状を一行メモ** (例: `2026-05-05 14:23 JST — フォームが captcha failed 連発`)
2. 該当する節を以下から選ぶ
3. 復旧後、最後に「ふりかえり」節を埋める

---

## A. シークレット漏洩疑い (チャット/screenshot/repo に貼ってしまった等)

**症状**: 自分が誤って push / paste した形跡を見つけた / 他人が指摘した

**即時手順**:
1. CF Pages > Settings > Variables and Secrets で該当 secret を**直ちに削除**
2. 発行元 (Brevo / Turnstile / Google) の管理画面で**当該キーを revoke**
3. [`docs/secret-rotation.md`](secret-rotation.md) に従って**新しいキーを発行**
4. CF Pages env vars に新値を貼り直し → **Retry deployment**
5. 検証: `/api/health` 200 / フォーム1件で受理メール届く
6. 漏洩経路を特定 (Slack? screenshot? repo?) — 同じ事故を再発させない

**ふりかえり**:
- 発生 / 検知 / 対応の各時刻
- 何が漏れたか / どのチャネル経由で
- どうやって防ぐか (例: 「次回 secret は最初から CF 管理画面で生成、コピーは clipboard 経由のみ」)

---

## B. 攻撃 (フォーム abuse / DoS / なりすまし送信)

**症状**: 不審なアクセス急増、Turnstile 失敗多発、不審な MX 失敗、自分宛に「ICEN ALERT」メールが届いた

**即時手順**:
1. CF Pages > Functions > Logs (or Real-time logs) で発生元 IP / pattern を確認
2. 影響評価:
   - 申請が大量に発番されてないか → KV `email:*` キー数を ListNamespaces で確認
   - 自分宛に大量にメールが届いてる → Brevo 残枠を見る
3. 暫定ブロック:
   - 単一 IP からなら → `_lib.ts` の rate limit を一時的に厳しく (5/h → 1/h) して push
   - 広範な攻撃なら → Cloudflare Dashboard > Security > WAF > Custom Rule で IP/ASN/Country ブロック
4. KV クリーンアップ: 怪しい `email:*` レコードを `wrangler kv:key delete` で削除
5. abuse 元に応じてフォーム一時的に閉じる (apply.ts 冒頭で 503 返す) — 過剰反応せず

**ふりかえり**:
- 攻撃の規模 (req/min, 影響件数)
- どの防御層で止まった / 突破された
- 強化案 (Tier 1+2 で足りないなら double-opt-in 強化、CAPTCHA 強度上げ等)

---

## C. メール配信不能 (Brevo 401/403/429/quota)

**症状**: `mail send failed (XXX)` が連発、受理通知が届かない

**即時手順**:
1. Brevo ダッシュ > Statistics > Today で残枠/エラー率確認
2. 401: API Key revoke されてる → 再発行 → CF Pages env 更新 → Retry
3. 429: レート制限 → 数分待つ + 1日上限 (300通/日) チェック
4. 402: クォータ超過 → 翌日待つ or プランアップグレード検討
5. その他: Brevo status page (https://status.brevo.com/) 確認

**暫定対応**:
- 受理通知が出せない間は、フォーム成功時のメッセージに「メールは配信障害中。数時間後に再送試行します」を追加 push
- 復旧後、KV から該当 email を取り出して再送スクリプトを Hetzner で1回叩く (将来実装)

---

## D. KV データ消失 (誤操作・CF 障害)

**症状**: 申請者が「申請したのに重複扱いされる」と連絡 / KV namespace の中身が消えた

**即時手順**:
1. CF Pages > Settings > Bindings > KV namespace の名前/ID 確認 — bind 先がズレてないか
2. KV 一覧で `seq:next`, `email:*`, `rate:*` 等のキーが残っているか
3. もし全消し → 復旧不能 (KV に backup 機構なし、CF 側のロールバックなし)
4. 再構築: 連絡してきた申請者に手動で「再申請のお願い」を送る

**予防 (将来)**:
- Workers Cron で日次 KV ダンプ → R2 へバックアップ (~50円/月)

---

## E. CF Pages デプロイ失敗 / サイトが表示されない

**症状**: GitHub Pages や natto-5hv.pages.dev が 5xx / build error

**即時手順**:
1. CF Pages > Deployments タブで最新の失敗ログ確認
2. 直前の commit を特定 (master ブランチ)
3. ロールバック: GitHub で `git revert <SHA> && git push` → CF が再デプロイ
4. もしくは CF dashboard > Deployments > 古い緑デプロイの「⋯」 > **Rollback to this version**

---

## F. Hetzner cron (活動報告自動生成) 停止

**症状**: 数日間 commit が止まっている / `/var/log/icen.log` にエラー

**即時手順**:
1. Hetzner SSH → `crontab -l` で cron 残ってる?
2. `tail -100 /var/log/icen.log` でエラー確認
3. よくあるエラー:
   - `GEMINI_API_KEY not set` → `.env` 復旧
   - Gemini 503/429 → 一時的、放置
   - `git push` 認証失敗 → SSH key / token 確認
4. 手動実行で動作確認: `bash scripts/update.sh`

---

## ふりかえり template (毎回これを末尾に付ける)

```
date:           YYYY-MM-DD
incident type:  A/B/C/D/E/F or other
detected by:    self / user report / monitoring alert
duration:       X minutes / hours
impact:         (件数 / 利用者影響)
root cause:     (一行)
mitigation:     (今回やった対応)
prevention:     (今後どう防ぐか — 反映先: code / doc / config)
```
