#!/usr/bin/env python3
"""Generate one new ICEN activity report and append to data/activities.json.

Modes:
  --mode=regular  (default) — regular 23-day cycle communiqué
  --mode=annual           — Kyoto Summit publish-day communiqué (3rd Sun of Mar + 3 days = Wed)
"""
from __future__ import annotations
import argparse, json, sys, datetime as dt, random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import _gemini  # noqa: E402
from scheduler import annual_publish_date  # noqa: E402

ACTIVITIES = ROOT / "data" / "activities.json"

REGULAR_PROMPT = """あなたは架空の国際機関「国際納豆撲滅協議会(ICEN)」の広報担当です。
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
- タグ: 英語1〜2語(例: Bulletin №NN / Field Op / Research / Diplomacy / Doctrine / Communiqué / Hearing / Education)
  - Bulletin №NN を使う場合は、過去最大番号+1〜+5の範囲
  - 「Annual Summit」は使用禁止(年次定例会議専用)

【出力形式】 JSON のみ。コードフェンス禁止。キーは date / title / body / tag のみ。
"""

ANNUAL_PROMPT = """あなたは架空の国際機関「国際納豆撲滅協議会(ICEN)」の広報担当です。
ICENは1972年京都密約より納豆撲滅を志す加盟5カ国(仏・伊・韓・伯・墨)の協議会で、
極めて真面目な口調で滑稽な活動を行うパロディ団体です。

【今日の出来事】
本協議会は3月第3日曜日より3日間、京都某所にて年次総会「京都密会」を開催。
本日({target_date} 水曜日)はその閉幕より3日後の公式コミュニケ発表日にあたります。

  - 第NN回京都密会
  - 開催期間: {meeting_from}(日) 〜 {meeting_to}(火)
  - 開催地: 京都某所
  - 出席: 加盟5カ国(仏・伊・韓・伯・墨)+ 観察国代表

【過去の京都密会記録】
{kyoto_history}

過去最新が「第54回」(2026.03.18公表)です。今回は「第{next_n}回」になります。

これを公式に発表する活動報告を1件、生成してください。

【条件】
- 日付: {target_date} (yyyy.mm.dd 形式・水曜日)
- タイトル: 「第{next_n}回京都密会 開催」を含む。副題を加えても良い(全体24字以内目安)
- 本文: 90〜140字
  - 3日間の討議に言及
  - 加盟国代表数(60〜70名程度)、議題、成果のいずれかに触れる
  - 過去の議題と内容が重複しないように工夫
  - 茨城県を一律に敵視しない温度感を保つ
- タグ: 「Annual Summit」(必ずこれ)

【出力形式】 JSON のみ。コードフェンス禁止。キーは date / title / body / tag のみ。
"""


def parse_date(s: str) -> dt.date:
    return dt.datetime.strptime(s, "%Y.%m.%d").date()


def build_regular(events: list[dict]) -> tuple[str, str]:
    recent_lines = [f"- {e['date']} / {e['title']} / {e['tag']}" for e in events[-6:]]
    last = max(parse_date(e["date"]) for e in events)
    today = dt.date.today()
    earliest = last + dt.timedelta(days=2)
    latest = today + dt.timedelta(days=2)
    if earliest > latest:
        target = earliest
    else:
        target = earliest + dt.timedelta(days=random.randint(0, (latest - earliest).days))
    target_str = target.strftime("%Y.%m.%d")
    return REGULAR_PROMPT.format(recent="\n".join(recent_lines), target_date=target_str), target_str


def build_annual(events: list[dict]) -> tuple[str, str]:
    today = dt.date.today()
    target = annual_publish_date(today.year) if today.year >= 2026 else today
    target_str = target.strftime("%Y.%m.%d")
    meeting_from = (target - dt.timedelta(days=3)).strftime("%Y.%m.%d")
    meeting_to = (target - dt.timedelta(days=1)).strftime("%Y.%m.%d")
    kyoto = [
        f"- {e['date']} / {e['title']}"
        for e in events
        if "京都密会" in e.get("title", "")
    ][-6:]
    next_n = 54 + max(1, sum(1 for e in events if "京都密会" in e.get("title", "")))
    prompt = ANNUAL_PROMPT.format(
        target_date=target_str,
        meeting_from=meeting_from,
        meeting_to=meeting_to,
        kyoto_history="\n".join(kyoto) or "(none yet)",
        next_n=next_n,
    )
    return prompt, target_str


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["regular", "annual"], default="regular")
    args = p.parse_args()

    data = json.loads(ACTIVITIES.read_text(encoding="utf-8"))
    events = data["events"]
    prompt, target_str = (build_annual(events) if args.mode == "annual" else build_regular(events))

    raw = _gemini.call(prompt, temperature=1.05 if args.mode == "annual" else 1.1)
    new = _gemini.parse_json(raw)
    for k in ("date", "title", "body", "tag"):
        if k not in new or not isinstance(new[k], str) or not new[k].strip():
            raise SystemExit(f"invalid generation, missing/empty: {k}\n--- raw ---\n{raw}")
    if not new["date"] or len(new["date"]) != 10:
        new["date"] = target_str
    if args.mode == "annual":
        new["tag"] = "Annual Summit"

    events.append({k: new[k].strip() for k in ("date", "title", "body", "tag")})
    ACTIVITIES.write_text(
        json.dumps({"events": events}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"appended ({args.mode}): {new['date']} / {new['title']} / {new['tag']}")


if __name__ == "__main__":
    main()
