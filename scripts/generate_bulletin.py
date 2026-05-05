#!/usr/bin/env python3
"""Rotate one bulletin (緊急電光ニュース) in data/bulletins.json.
Pops the oldest item and appends a freshly generated one."""
from __future__ import annotations
import json, sys, random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import _gemini  # noqa: E402

BULLETINS = ROOT / "data" / "bulletins.json"

PROMPT = """あなたは架空団体「国際納豆撲滅協議会(ICEN)」の電光ニュース編集者です。
ICENは1972年京都密約より納豆撲滅を志すパロディ団体で、極めて真面目な口調で滑稽な情報を発信します。

【現在ローテ中の電光ニュース】
{current}

これらと重複しない、新しい1行ニュースを1本生成してください。

【条件】
- 1行で完結 (改行禁止、40〜70字)
- 以下のタイプから1つを選んで雰囲気を作る:
  {style_hint}
- 「緊急声明」「臨時通達」「勧告」「見解」「報告」「速報」等の見出し語で始めると良い
- 英語版を作る場合は EMERGENCY BULLETIN / NOTICE / ADVISORY 等で始める
- 茨城県を一律に敵視しない。敬意とユーモアの境界を保つ
- 納豆/粘り/糸/匂い/朝食/発酵 のいずれかに触れる
- 既存と固有名詞・テーマが被らないように

【出力形式】 JSON のみ。コードフェンス禁止。キーは text のみ。
{{"text": "..."}}
"""

STYLES = [
    "緊急声明 第N号 — (国内/国際の事態を仰々しく告知。N は 78 より大きい整数)",
    "次回京都密会の議題予告(極めて些末な議題を重大事のように)",
    "EMERGENCY BULLETIN №NN(英語版・日本語版とは別件)",
    "新規入会者数・観察国動向の速報(数字を1つ含める)",
    "機関誌『非粘月報』新刊予告(特集タイトル付き)",
    "加盟国某政府関係者の発言を引用形式で(※架空人物)",
]

def main() -> None:
    data = json.loads(BULLETINS.read_text(encoding="utf-8"))
    items = data["items"]
    current_lines = [f"- {it}" for it in items]
    style = random.choice(STYLES)

    prompt = PROMPT.format(current="\n".join(current_lines), style_hint=style)
    raw = _gemini.call(prompt, temperature=1.1)
    new = _gemini.parse_json(raw)
    text = (new.get("text") or "").strip()
    if not text or "\n" in text:
        raise SystemExit(f"invalid bulletin: {raw!r}")

    items.pop(0)
    items.append(text)
    BULLETINS.write_text(
        json.dumps({"items": items}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"rotated bulletin: {text}")

if __name__ == "__main__":
    main()
