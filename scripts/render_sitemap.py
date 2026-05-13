#!/usr/bin/env python3
"""Regenerate sitemap.xml from a fixed URL list, using each source file's
Git last-modified date as <lastmod>. Run from update.sh after content
changes; idempotent (commits only if sitemap diffs).
"""
from __future__ import annotations
import subprocess, datetime as dt
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://natto-5hv.pages.dev"

# (loc_path, source_file_for_mtime, changefreq, priority)
ENTRIES: list[tuple[str, str, str, str]] = [
    ("/",                          "index.html",            "weekly",  "1.0"),
    ("/welcome.html",              "welcome.html",          "monthly", "0.9"),
    ("/faq.html",                  "faq.html",              "monthly", "0.85"),
    ("/privacy",                   "privacy.html",          "yearly",  "0.5"),
    ("/delete-request.html",       "delete-request.html",   "yearly",  "0.3"),
    ("/feedback.html",             "feedback.html",         "yearly",  "0.4"),
    ("/quiz.html",                 "quiz.html",             "monthly", "0.8"),
    ("/charges/visual.html",       "charges/visual.html",   "yearly",  "0.7"),
    ("/charges/smell.html",        "charges/smell.html",    "yearly",  "0.7"),
    ("/charges/touch.html",        "charges/touch.html",    "yearly",  "0.7"),
    ("/charges/ethics.html",       "charges/ethics.html",   "yearly",  "0.7"),
    ("/charges/social.html",       "charges/social.html",   "yearly",  "0.7"),
]


def git_lastmod(file: Path) -> str:
    """Return ISO date (YYYY-MM-DD) of the last Git commit that touched the file.
    Falls back to filesystem mtime if Git history is missing."""
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%cI", "--", str(file.relative_to(ROOT))],
            cwd=ROOT, text=True,
        ).strip()
        if out:
            # %cI = strict ISO 8601 incl tz; trim to date only
            return out.split("T")[0]
    except (subprocess.CalledProcessError, ValueError):
        pass
    if file.exists():
        ts = dt.datetime.utcfromtimestamp(file.stat().st_mtime)
        return ts.strftime("%Y-%m-%d")
    return dt.date.today().isoformat()


def main() -> None:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
        '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ]
    for loc_path, source, changefreq, priority in ENTRIES:
        src = ROOT / source
        if not src.exists():
            # Skip entries whose source file doesn't exist (e.g. quiz pre-launch)
            continue
        lastmod = git_lastmod(src)
        lines.append(f'  <url>')
        lines.append(f'    <loc>{SITE}{loc_path}</loc>')
        lines.append(f'    <lastmod>{lastmod}</lastmod>')
        lines.append(f'    <changefreq>{changefreq}</changefreq>')
        lines.append(f'    <priority>{priority}</priority>')
        # hreflang only on the homepage
        if loc_path == "/":
            lines.append(f'    <xhtml:link rel="alternate" hreflang="ja" href="{SITE}/" />')
            lines.append(f'    <xhtml:link rel="alternate" hreflang="x-default" href="{SITE}/welcome.html" />')
        lines.append(f'  </url>')
    lines.append("</urlset>")
    out = "\n".join(lines) + "\n"
    (ROOT / "sitemap.xml").write_text(out, encoding="utf-8")
    print(f"sitemap.xml: {len([e for e in ENTRIES if (ROOT / e[1]).exists()])} URLs written")


if __name__ == "__main__":
    main()
