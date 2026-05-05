#!/usr/bin/env python3
"""Generate one new ICEN activity report and append to data/activities.json."""
from __future__ import annotations
import json, sys, datetime as dt, random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import _gemini  # noqa: E402

ACTIVITIES = ROOT / "data" / "activities.json"

PROMPT = """あなたは架空の国際機関「国際納豆撲滅協議会(ICEN)」の広報担当です。
ICENは1972年京都密約より納豆撲滅を志す加盟5カ国(仏・伊・韓・伯・墨)の協議会で、
極めて真面目な口調で滑稽な活動を行うパロディ団体です。

【過去の活動報告(直近)】
{recent}

これに続く新しい活動報告を1件、生成してください。

【条件】
- 日付: {target_date} (この日付を date に入れる。yyyy.mm.dd 形式)
- タイトル: 24字以内、明朝に映える堅めの語彙(発令/通達/勧告/見解/締結/受理/受諾/抗議/通牒 等)
- カギカッコ「…」を1〜2回使うと雰囲気が出る
- 本文: 90〜140字、協議会らしい大袈裟な解釈と機微の効いたユーモア
  - 茨城県/茨城を一律に敵視せず、敬意と緊張を併存させる温度感
  - 過去報告と内容・固有名詞が重複しないこと
  - 納豆/糸/粘り/匂い/朝食/発酵 のいずれかには触れる
- タグ: 英語1〜2語(例: Annual Summit / Bulletin №NN / Field Op / Research / Diplomacy / Doctrine / Communiqué / Hearing)
  - Bulletin №NN を使う場合は、過去最大番号+1〜+5の範囲

【出力形式】 JSON のみ。コードフェンス禁止。キーは date / title / body / tag のみ。
"""

def main() -> None:
    data = json.loads(ACTIVITIES.read_text(encoding="utf-8"))
    events = data["events"]
    recent_lines = [
        f"- {e['date']} / {e['title']} / {e['tag']}"
        for e in events[-6:]
    ]
    last_date_str = events[-1]["date"]
    last = dt.datetime.strptime(last_date_str, "%Y.%m.%d").date()
    today = dt.date.today()
    earliest = last + dt.timedelta(days=2)
    latest = today + dt.timedelta(days=5)
    if earliest > latest:
        target = earliest
    else:
        delta = (latest - earliest).days
        target = earliest + dt.timedelta(days=random.randint(0, delta))
    target_str = target.strftime("%Y.%m.%d")

    prompt = PROMPT.format(recent="\n".join(recent_lines), target_date=target_str)
    raw = _gemini.call(prompt, temperature=1.1)
    new = _gemini.parse_json(raw)
    for k in ("date", "title", "body", "tag"):
        if k not in new or not isinstance(new[k], str) or not new[k].strip():
            raise SystemExit(f"invalid generation, missing/empty: {k}\n--- raw ---\n{raw}")
    if not new["date"].startswith("2026."):
        new["date"] = target_str
    events.append({k: new[k].strip() for k in ("date", "title", "body", "tag")})
    ACTIVITIES.write_text(
        json.dumps({"events": events}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"appended: {new['date']} / {new['title']} / {new['tag']}")

if __name__ == "__main__":
    main()
