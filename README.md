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
cd /home/tama/projects/natto-eradication
python3 -m http.server 8000
# → http://localhost:8000 で確認
```

Mac から見る場合は git pull して同様に。

## 自動更新パイプライン

> 「適当な活動報告を不定期にそれっぽく生成して、反映」させるための仕組み。

```
[cron] → update.sh
           ├── generate_activity.py  (Gemini が新しい活動報告を1件生成)
           ├── generate_bulletin.py  (緊急声明 ticker をローテーション)
           ├── render.py             (data/*.json → index.html を書き換え)
           └── git add + commit + push
                  ↓
             GitHub Pages 自動再ビルド (~30秒)
```

### 環境変数

```bash
export GEMINI_API_KEY="..."        # 必須 (Gemini 2.5 Flash 使用)
```

`/home/tama/ai-agent-team/.env` に既存のキーがあるので、`update.sh` 冒頭で source 済み。

### Cron 例 (Hetzner)

```cron
# 4日おきに、9:00 / 14:00 / 20:00 のいずれか1回実行
0 9 */4 * * cd /home/tama/projects/natto-eradication && bash scripts/update.sh >> /var/log/icen.log 2>&1
```

ランダムにしたければ `update.sh` 内で 30% 確率実行などのゲートを足す。

### 手動実行

```bash
cd /home/tama/projects/natto-eradication
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

## 公開フロー

`master` への push で GitHub Pages が自動再ビルド。手動デプロイ不要。

## ライセンス・免責 (詳細)

本サイトはユーモアを目的としたパロディです。実在の人物・団体・地域・自治体とは一切関係ありません。

- 納豆は健康に良い伝統食品です
- 茨城県は素敵な県です (水戸納豆発祥の地への敬意)
- 上記5カ国 (仏伊韓伯墨) は実際には ICEN という協議会に加盟していません (存在しないので)
- 「ジャン=ピエール・ルセール」「宮川 透」等はすべて架空人物です

コードと文章は MIT ライセンス相当で自由に改変可。ただし類似のパロディを作る場合は、対象への敬意と免責文を必ず添えてください。

---

🍽 *NATTO IS DELICIOUS. THIS IS JUST A JOKE.*
