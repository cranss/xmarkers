/** Parser compartido — mismo formato que index.html */
const XMarkersParser = (() => {
  function parseEngagement(ariaLabel) {
    if (!ariaLabel) return {};
    const out = {};
    const patterns = [
      [/(\d[\d.,]*)\s+respuestas?/i, "replies"],
      [/(\d[\d.,]*)\s+reposts?/i, "reposts"],
      [/(\d[\d.,]*)\s+Me gusta/i, "likes"],
      [/(\d[\d.,]*)\s+elementos guardados/i, "bookmarks"],
      [/(\d[\d.,]*)\s+reproducciones/i, "views"],
    ];
    for (const [re, key] of patterns) {
      const m = ariaLabel.match(re);
      if (m) out[key] = parseInt(m[1].replace(/[.,]/g, ""), 10);
    }
    return out;
  }

  function textFromTweet(article) {
    const node = article.querySelector('[data-testid="tweetText"]');
    if (!node) return "";
    let text = "";
    const walk = (el) => {
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
        else if (child.nodeName === "IMG" && child.alt) text += child.alt;
        else if (child.nodeType === Node.ELEMENT_NODE) walk(child);
      }
    };
    walk(node);
    return text.replace(/\s+/g, " ").trim();
  }

  function hashtagsFromTweet(article) {
    const tags = [];
    article.querySelectorAll('[data-testid="tweetText"] a[href*="/hashtag/"]').forEach((a) => {
      const m = a.getAttribute("href")?.match(/\/hashtag\/([^?]+)/);
      if (m) tags.push(decodeURIComponent(m[1]));
    });
    return tags;
  }

  function mediaFromTweet(article) {
    const media = { type: null, urls: [] };
    if (article.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"]')) media.type = "video";
    else if (article.querySelector('[data-testid="tweetPhoto"]')) media.type = "photo";
    else if (article.querySelector('[data-testid="card.wrapper"]')) media.type = "link";

    article.querySelectorAll("img[src]").forEach((img) => {
      const src = img.src;
      if (src.includes("profile_images") || src.includes("emoji")) return;
      if (src.startsWith("https://") && !media.urls.includes(src)) media.urls.push(src);
    });
    return media;
  }

  function parseTweet(article) {
    const status = article.querySelector('a[href*="/status/"]');
    if (!status) return null;
    const m = status.getAttribute("href")?.match(/\/([^/]+)\/status\/(\d+)/);
    if (!m) return null;
    const [, username, tweetId] = m;

    const timeEl = article.querySelector("time[datetime]");
    const dateIso = timeEl?.getAttribute("datetime") || null;
    const dateDisplay = timeEl?.textContent?.replace(/\s+/g, " ").trim() || null;

    let displayName = "";
    let handle = "";
    const nameBlock = article.querySelector('[data-testid="User-Name"]');
    if (nameBlock) {
      const texts = [...nameBlock.querySelectorAll("span.css-1jxf684")]
        .map((s) => s.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      for (const t of texts) {
        if (t.startsWith("@")) handle = t;
        else if (!displayName && t !== "·") displayName = t;
      }
    }
    if (!handle) handle = `@${username}`;

    const avatarEl = article.querySelector('[data-testid="Tweet-User-Avatar"] img[src*="profile_images"]');
    const engagementEl = article.querySelector('[role="group"][aria-label*="Me gusta"], [role="group"][aria-label*="respuestas"]');

    return {
      id: tweetId,
      url: `https://x.com/${username}/status/${tweetId}`,
      username,
      handle,
      displayName,
      avatar: avatarEl?.src || "",
      verified: !!article.querySelector('[data-testid="icon-verified"]'),
      date: dateIso,
      dateDisplay,
      text: textFromTweet(article),
      hashtags: hashtagsFromTweet(article),
      engagement: parseEngagement(engagementEl?.getAttribute("aria-label")),
      liked: !!article.querySelector('[data-testid="unlike"]'),
      media: mediaFromTweet(article),
      tags: [],
      notes: "",
      sortOrder: null,
    };
  }

  function detectFolder(root = document) {
    const timeline = root.querySelector('[aria-label^="Cronología:"]');
    if (timeline) {
      return timeline.getAttribute("aria-label").replace("Cronología:", "").trim();
    }
    if (location.pathname.includes("/i/bookmarks")) return "Marcadores";
    return "Desconocido";
  }

  function estimateVirtualTotal(root = document) {
    const scrollRoot = root.querySelector('[style*="min-height"]');
    if (!scrollRoot) return null;
    const m = scrollRoot.getAttribute("style")?.match(/min-height:\s*(\d+)px/);
    if (!m) return null;
    const minHeight = parseInt(m[1], 10);
    const cells = root.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (cells.length < 2) return null;
    let totalCellHeight = 0;
    cells.forEach((c) => {
      const h = c.getBoundingClientRect().height;
      if (h > 50) totalCellHeight += h;
    });
    const avg = totalCellHeight / cells.length;
    if (avg < 50) return null;
    return Math.round(minHeight / avg);
  }

  function folderKey(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
  }

  function toExportFormat(collection) {
    const bookmarks = Object.values(collection.bookmarks || {});
    bookmarks.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return {
      folder: collection.folder,
      parsedAt: new Date().toISOString(),
      count: bookmarks.length,
      bookmarks,
      source: "xmarkers-extension",
      capturedAt: { started: collection.startedAt, updated: collection.updatedAt },
      estimatedTotal: collection.estimatedTotal ?? null,
    };
  }

  return { parseTweet, detectFolder, estimateVirtualTotal, folderKey, toExportFormat };
})();

if (typeof module !== "undefined") module.exports = XMarkersParser;
