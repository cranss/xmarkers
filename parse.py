#!/usr/bin/env python3
"""Extrae posts de marcadores X desde HTML pegado (view-source de carpeta)."""

from __future__ import annotations

import json
import re
import sys
from html import unescape
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("Instala dependencias: pip install beautifulsoup4", file=sys.stderr)
    sys.exit(1)


def parse_engagement(aria_label: str | None) -> dict:
    if not aria_label:
        return {}
    out: dict[str, int] = {}
    patterns = [
        (r"(\d[\d.,]*)\s+respuestas?", "replies"),
        (r"(\d[\d.,]*)\s+reposts?", "reposts"),
        (r"(\d[\d.,]*)\s+Me gusta", "likes"),
        (r"(\d[\d.,]*)\s+elementos guardados", "bookmarks"),
        (r"(\d[\d.,]*)\s+reproducciones", "views"),
    ]
    for pattern, key in patterns:
        m = re.search(pattern, aria_label, re.I)
        if m:
            out[key] = int(m.group(1).replace(".", "").replace(",", ""))
    return out


def text_from_tweet(el) -> str:
    node = el.select_one('[data-testid="tweetText"]')
    if not node:
        return ""
    parts: list[str] = []
    for child in node.descendants:
        if getattr(child, "name", None) == "img" and child.get("alt"):
            parts.append(child["alt"])
        elif isinstance(child, str):
            parts.append(child)
    return unescape(re.sub(r"\s+", " ", "".join(parts)).strip())


def hashtags_from_tweet(el) -> list[str]:
    tags = []
    for a in el.select('[data-testid="tweetText"] a[href*="/hashtag/"]'):
        href = a.get("href", "")
        m = re.search(r"/hashtag/([^?]+)", href)
        if m:
            tags.append(unescape(m.group(1)))
    return tags


def media_from_tweet(el) -> dict:
    media: dict = {"type": None, "urls": []}
    if el.select_one('[data-testid="videoPlayer"], [data-testid="videoComponent"]'):
        media["type"] = "video"
    elif el.select_one('[data-testid="tweetPhoto"]'):
        media["type"] = "photo"
    elif el.select_one('[data-testid="card.wrapper"]'):
        media["type"] = "link"

    for img in el.select("img[src]"):
        src = img.get("src", "")
        if "profile_images" in src:
            continue
        if "emoji" in src:
            continue
        if src.startswith("https://") and src not in media["urls"]:
            media["urls"].append(src)
    return media


def parse_tweet(article) -> dict | None:
    status = article.select_one('a[href*="/status/"]')
    if not status:
        return None
    href = status.get("href", "")
    m = re.match(r"/([^/]+)/status/(\d+)", href)
    if not m:
        return None
    username, tweet_id = m.group(1), m.group(2)

    time_el = article.select_one("time[datetime]")
    date_iso = time_el["datetime"] if time_el else None
    date_display = time_el.get_text(strip=True) if time_el else None

    display_name = ""
    handle = ""
    name_block = article.select_one('[data-testid="User-Name"]')
    if name_block:
        spans = name_block.select("span.css-1jxf684")
        texts = [re.sub(r"\s+", " ", s.get_text(strip=True)) for s in spans if s.get_text(strip=True)]
        for t in texts:
            if t.startswith("@"):
                handle = t
            elif not display_name and t not in ("·",):
                display_name = t
    if not handle:
        handle = f"@{username}"

    avatar = ""
    av = article.select_one('[data-testid="Tweet-User-Avatar"] img[src*="profile_images"]')
    if av:
        avatar = av["src"]

    engagement_el = article.select_one('[role="group"][aria-label*="respuestas"], [role="group"][aria-label*="Me gusta"]')
    engagement = parse_engagement(engagement_el.get("aria-label") if engagement_el else None)

    verified = bool(article.select_one('[data-testid="icon-verified"]'))
    liked = bool(article.select_one('[data-testid="unlike"]'))

    media = media_from_tweet(article)

    return {
        "id": tweet_id,
        "url": f"https://x.com/{username}/status/{tweet_id}",
        "username": username,
        "handle": handle,
        "displayName": display_name,
        "verified": verified,
        "date": date_iso,
        "dateDisplay": date_display,
        "text": text_from_tweet(article),
        "hashtags": hashtags_from_tweet(article),
        "engagement": engagement,
        "liked": liked,
        "media": media,
        "tags": [],
        "notes": "",
    }


def parse_html(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    folder = ""
    timeline = soup.select_one('[aria-label^="Cronología:"]')
    if timeline:
        label = timeline.get("aria-label", "")
        folder = label.replace("Cronología:", "").strip()

    tweets: list[dict] = []
    seen: set[str] = set()
    for article in soup.select('article[data-testid="tweet"]'):
        tweet = parse_tweet(article)
        if tweet and tweet["id"] not in seen:
            seen.add(tweet["id"])
            tweets.append(tweet)

    return {
        "folder": folder,
        "parsedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "count": len(tweets),
        "bookmarks": tweets,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Uso: {sys.argv[0]} markers.html [salida.json]", file=sys.stderr)
        sys.exit(1)

    src = Path(sys.argv[1])
    html = src.read_text(encoding="utf-8")
    data = parse_html(html)

    if len(sys.argv) >= 3:
        Path(sys.argv[2]).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Extraídos {data['count']} posts → {sys.argv[2]}")
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
