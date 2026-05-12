const { useEffect, useMemo, useState } = React;
const NAV = ["Shopify Search", "Bright data products", "TikTok Live", "Creators", "My Shopify", "Pricing", "Account"];

const SECTION_LABEL = {
  "top-ads": "Top ads",
  "trending": "Trending",
  "top-rated": "Top rated",
  "viral": "Viral",
  "influencer-reviews": "Influencer reviews",
  "tutorials": "Tutorials",
  "viral-unboxings": "Viral unboxings",
};
const CREATIVE_SECTIONS = ["top-ads", "trending", "influencer-reviews", "tutorials", "viral-unboxings"];
const PRODUCT_SECTIONS = ["top-ads", "trending", "top-rated", "viral", "influencer-reviews", "tutorials", "viral-unboxings"];
const PLAN_COPY = {
  trial: {
    tagline: "Try the platform before you commit",
    features: ["Unlock full discovery for a short window", "Run a handful of enrichments", "See exactly what we surface before you upgrade"],
  },
  explorer: {
    tagline: "For solo operators validating niches",
    features: ["Monthly credits for keyword & product research", "Creative library access", "Trend + engagement signals"],
  },
  pro: {
    tagline: "For small teams shipping winning products",
    features: ["Larger monthly credit pool", "Saved products & niche tracking", "Full creative & creator insights"],
  },
  premium: {
    tagline: "For agencies and serious operators",
    features: ["Highest monthly credit allocation", "Priority freshness on hot niches", "Everything in Pro, scaled up"],
  },
};

function toJsonSafe(text) { try { return JSON.parse(text); } catch (_err) { return text; } }
function toArray(v) { return Array.isArray(v) ? v : []; }
function data(payload) { return payload?.data ?? payload; }
function normalizeList(payload, listKeys) {
  const d = data(payload);
  if (!d) return { items: [], pagination: null };
  for (const key of listKeys) {
    if (Array.isArray(d?.[key])) return { items: d[key], pagination: d.pagination || null };
  }
  if (Array.isArray(d)) return { items: d, pagination: payload?.pagination || null };
  if (Array.isArray(d.data)) return { items: d.data, pagination: d.pagination || null };
  return { items: [], pagination: d.pagination || null };
}

function normalizeBrightDataRecord(recordKey, recordValue) {
  const rec = recordValue || {};
  const raw = rec.rawPayload || {};
  const shop = raw.tiktokShop || {};
  const post = raw.postDemand || {};

  const productUrl = shop.productUrl || raw.target || raw.finalUrl || "";
  const postUrl = shop.postUrl || post.url || "";
  const videoUrl = shop.videoUrl || post.videoUrl || "";
  const images = toArray(shop.galleryImages).length > 0
    ? toArray(shop.galleryImages)
    : toArray(shop.images);

  return {
    id: shop.productId || rec.externalId || recordKey,
    external_id: rec.externalId || shop.productId || recordKey,
    source: rec.source || raw.source || "tiktok",
    source_entity_type: rec.sourceEntityType || "product",
    observed_at: rec.observedAt || shop.observedAt || raw.fetchedAt || "",
    fetched_at: rec.fetchedAt || raw.fetchedAt || "",
    parser_version: rec.parserVersion || "",
    freshness_status: rec.freshnessStatus || "",
    freshness_age_hours: rec.freshnessAgeHours,
    validation_status: rec.validationStatus || "",

    title: shop.title || "",
    description: shop.description || post.description || "",
    category: shop.category || "",
    brand: shop.brand || shop.sellerName || shop.shopName || "",
    currency: shop.currency || "USD",
    final_price: shop.price ?? shop.finalPrice,
    initial_price: shop.originalPrice ?? shop.initialPrice,
    discount_percent: shop.discountPercent ?? shop.discount_percent,
    In_stock: shop.inStock === true,
    sold: shop.soldCount,
    reviews_count: shop.reviewCount,

    url: productUrl,
    product_url: productUrl,
    post_url: postUrl,
    video_url: videoUrl,
    video_link: videoUrl,
    preview_image: shop.imageUrl || "",
    images,
    variations: toArray(shop.variations),
    specifications: toArray(shop.specifications),
    reviews: toArray(shop.reviews),
    colors: toArray(shop.colors),
    sizes: toArray(shop.sizes),
    seller_id: shop.sellerId || "",
    seller_name: shop.sellerName || "",
    shop_name: shop.shopName || "",
    shop_url: shop.shopUrl || "",
    store_details: {
      followers: shop.shopFollowers,
      num_items: shop.storeNumItems,
      num_sold: shop.storeNumSold,
      rating: shop.storeRating,
      badge: shop.storeBadge,
    },
    category_url: shop.categoryUrl || "",
    promotion_items: toArray(shop.promotionItems),
    Shop_performance_metrics: toArray(shop.shopPerformanceMetrics),

    creator_username: shop.creator?.handle || "",
    creator_name: shop.creator?.displayName || "",
    creator_url: shop.creator?.profileUrl || "",
    author_followers: shop.creator?.followers,
    post_metrics: shop.postMetrics || {},

    tiktok_shop: shop,
    post_demand: post,
    raw_payload: raw,
  };
}

function normalizeBrightDataPayload(parsed) {
  if (Array.isArray(parsed)) {
    return {
      products: parsed,
      exportedAt: "",
      totalRecords: parsed.length,
    };
  }

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.products)) {
    return {
      products: parsed.products,
      exportedAt: parsed.exportedAt || parsed.updatedAt || "",
      totalRecords: toArray(parsed.canonical_ingestion_records).length || parsed.products.length,
    };
  }

  if (parsed && typeof parsed === "object" && parsed.canonicalRecords && typeof parsed.canonicalRecords === "object") {
    const entries = Object.entries(parsed.canonicalRecords);
    const products = entries
      .map(([k, v]) => normalizeBrightDataRecord(k, v))
      .filter((x) => brightDataIsPresent(x?.title) || brightDataIsPresent(x?.description) || brightDataIsPresent(x?.id));

    return {
      products,
      exportedAt: parsed.updatedAt || "",
      totalRecords: entries.length,
    };
  }

  throw new Error("Unsupported Bright Data export shape. Expected array, `{ products: [] }`, or `{ canonicalRecords: {} }`.");
}

function normalizeDbProductRecord(item) {
  if (!item || typeof item !== "object") return null;
  const creator = item.primaryCreator || {};
  const reviews = toArray(item.reviews).map((r) => ({
    source: r?.source || "",
    review: r?.text || "",
    text: r?.text || "",
    rating: null,
  }));
  const sold = item.totalSale30d ?? item.salesEvidence?.unitsSold ?? null;
  return {
    ...item,
    id: item._id || item.id || item.externalId || "",
    external_id: item.externalId || "",
    source: item.source || "scarper",
    title: item.title || "",
    description: item.description || "",
    category: item.categoryL3 || item.categoryL2 || item.categoryL1 || "",
    currency: item.currency || "USD",
    final_price: item.price,
    reviews_count: item.reviewCount,
    sold,
    product_url: item.salesEvidence?.storeUrl || item.extraData?.rawPayload?.tiktokShop?.productUrl || "",
    post_url: creator?.tiktokPostUrl || item.extraData?.rawPayload?.postDemand?.url || "",
    preview_image: item.primaryImageUrl || "",
    images: toArray(item.imageUrls),
    brand: item.aiIntelligence?.brand || "",
    freshness_status: item.status || "",
    observed_at: item.dataSourceUpdatedAt || "",
    fetched_at: item.lastIngestedAt || "",
    reviews,
    primary_creator: creator,
  };
}
function compactNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "-";
  if (Math.abs(num) >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(num) >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (Math.abs(num) >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}
function formatMoney(amountCents, currency) {
  if (amountCents == null) return null;
  const amount = amountCents / 100;
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount);
  } catch (_err) {
    return `$${amount.toFixed(2)}`;
  }
}
function formatPrice(price, currency) {
  if (price == null || price === "") return null;
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(Number(price));
  } catch (_err) {
    return `${code} ${Number(price).toFixed(2)}`;
  }
}

/** true for values we should show in the UI (skips null, empty string, empty array/object) */
function brightDataIsPresent(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function brightDataLabel(key) {
  if (!key) return "";
  return String(key)
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function brightDataTitle(item) {
  if (!item) return "Product";
  const t = item.title || item.name;
  if (typeof t === "string" && t.trim()) return t.trim();
  const d = item.description;
  if (typeof d === "string" && d.trim()) return d.trim().slice(0, 120) + (d.length > 120 ? "…" : "");
  return item.id || item.product_id || item.external_id || "Product";
}

function brightDataGalleryImages(item) {
  if (!item) return [];
  const out = [];
  const preview = item.preview_image;
  if (typeof preview === "string" && preview.trim()) out.push(preview.trim());
  const previewCamel = item.previewImage;
  if (typeof previewCamel === "string" && previewCamel.trim()) out.push(previewCamel.trim());
  const imageUrl = item.imageUrl;
  if (typeof imageUrl === "string" && imageUrl.trim()) out.push(imageUrl.trim());
  const primaryImageUrl = item.primaryImageUrl;
  if (typeof primaryImageUrl === "string" && primaryImageUrl.trim()) out.push(primaryImageUrl.trim());
  const carousel = toArray(item.carousel_images).filter(Boolean);
  out.push(...carousel);
  const gallery = toArray(item.galleryImages).filter(Boolean);
  out.push(...gallery);
  const imgs = toArray(item.images).filter(Boolean);
  out.push(...imgs);
  const imageUrls = toArray(item.imageUrls).filter(Boolean);
  out.push(...imageUrls);
  // de-dupe
  return Array.from(new Set(out));
}

function brightDataCardImage(item) {
  if (!item) return "";
  const gallery = brightDataGalleryImages(item);
  const fromArr = gallery.find(Boolean);
  return fromArr || item.primary_image_url || item.profile_avatar || "";
}

function brightDataCardPrice(item) {
  if (!item) return null;
  const cur = item.currency || "USD";
  const p = item.final_price ?? item.price ?? item.finalPrice ?? item.originalPrice;
  return formatPrice(p, cur);
}

/** TikTok *web* post / ad landing page (not Shop PDP, not raw CDN video) */
function isLikelyTiktokPostWebUrl(href) {
  if (!href || typeof href !== "string") return false;
  const u = href.trim().toLowerCase();
  if (!/^https?:\/\//i.test(u)) return false;
  if (u.includes("tiktokcdn") || u.includes("ttcdn") || u.includes("ibyteimg.com")) return false;
  if (u.includes("/view/product")) return false;
  if (u.includes("/shop/c/") || u.includes("/shop/category")) return false;
  if (u.includes("vm.tiktok.com") || u.includes("vt.tiktok.com")) return true;
  if (!u.includes("tiktok.com")) return false;
  if (u.includes("/@") && u.includes("/video/")) return true;
  if (u.includes("/video/")) return true;
  if (u.includes("/t/")) return true;
  return false;
}

function brightDataAdvertisingPostLink(item) {
  if (!item) return "";
  const postKeys = [
    "post_url", "tiktok_post_url", "video_post_url", "organic_video_url",
    "advertising_post_url", "creator_post_url", "tiktok_video_url", "postUrl",
  ];
  for (const k of postKeys) {
    const v = item[k];
    if (typeof v === "string" && v.trim() && isLikelyTiktokPostWebUrl(v)) return v.trim();
  }
  const vl = item.video_link;
  const creatorPost = item?.primaryCreator?.tiktokPostUrl || item?.primary_creator?.tiktokPostUrl;
  if (typeof creatorPost === "string" && creatorPost.trim() && isLikelyTiktokPostWebUrl(creatorPost)) {
    return creatorPost.trim();
  }

  if (typeof vl === "string" && vl.trim() && isLikelyTiktokPostWebUrl(vl)) return vl.trim();

  const rel = toArray(item.related_videos);
  for (const rv of rel) {
    const L = rv?.post_url || rv?.tiktok_post_url || rv?.link || rv?.url;
    if (typeof L === "string" && L.trim() && isLikelyTiktokPostWebUrl(L)) return L.trim();
  }

  // New export shape: `url` is often the web post itself.
  if (typeof item.url === "string" && item.url.trim() && isLikelyTiktokPostWebUrl(item.url)) {
    return item.url.trim();
  }

  return "";
}

/** Shop / product listing page (PDP), not category browse */
function brightDataProductPageLink(item) {
  if (!item) return "";
  const u = item.url || item.product_url || item.productUrl || item.shareUrl || item.share_url || item?.salesEvidence?.storeUrl;
  return typeof u === "string" && u.trim() ? u.trim() : "";
}

/** Raw stream / CDN URL when there is no web post URL */
function brightDataDirectVideoLink(item) {
  if (!item) return "";
  const v = item.video_link;
  if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    if (!isLikelyTiktokPostWebUrl(t) && /^https?:\/\//i.test(t)) return t;
  }
  const firstVid = toArray(item.videos).find((x) => typeof x === "string" && /^https?:\/\//i.test(String(x).trim()));
  return firstVid ? String(firstVid).trim() : "";
}

function brightDataPrimaryLink(item) {
  return brightDataAdvertisingPostLink(item) || brightDataProductPageLink(item) || brightDataDirectVideoLink(item);
}

function brightDataPrimaryLinkLabel(item) {
  if (brightDataAdvertisingPostLink(item)) return "Open post ↗";
  if (brightDataProductPageLink(item)) return "Open product ↗";
  if (brightDataDirectVideoLink(item)) return "Open video ↗";
  return "Open link ↗";
}

function brightDataCardLink(item) {
  return brightDataPrimaryLink(item);
}

function tiktokLiveOwnerHandle(item) {
  return item?.owner?.unique_id || item?.owner?.nickname || "";
}

function tiktokLiveWatchUrl(item) {
  const candidates = [
    item?.owner?.live_room_url,
    item?.owner?.share_url,
    item?.share_url,
    item?.shareUrl,
    item?.url,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const handle = tiktokLiveOwnerHandle(item);
  if (handle) {
    return `https://www.tiktok.com/@${String(handle).trim()}/live`;
  }
  return "";
}

function tiktokLiveStreamUrl(item) {
  const streamUrl = item?.stream_url || {};
  const flv = streamUrl?.flv_pull_url || {};
  const hls = streamUrl?.hls_pull_url || {};
  const order = [
    hls.FULL_HD1,
    hls.HD1,
    hls.SD1,
    ...Object.values(hls),
    flv.FULL_HD1,
    flv.HD1,
    flv.SD1,
    ...Object.values(flv),
    streamUrl?.rtmp_pull_url,
    streamUrl?.hls_pull_url,
    streamUrl?.flv_pull_url,
  ];
  for (const value of order) {
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) {
      return value.trim();
    }
  }
  return "";
}

function tiktokLivePlayableStreamUrl(item) {
  const streamUrl = item?.stream_url || {};
  const flv = streamUrl?.flv_pull_url || {};
  const hls = streamUrl?.hls_pull_url || {};
  const pool = [
    streamUrl?.mp4_pull_url,
    streamUrl?.play_url,
    ...Object.values(streamUrl?.play_url_map || {}),
    ...Object.values(hls),
    ...Object.values(flv),
    streamUrl?.hls_pull_url,
    streamUrl?.flv_pull_url,
  ]
    .filter((x) => typeof x === "string" && /^https?:\/\//i.test(x.trim()))
    .map((x) => x.trim());
  const uniq = Array.from(new Set(pool));

  const mp4 = uniq.find((u) => /\.mp4($|\?)/i.test(u));
  if (mp4) return mp4;

  const m3u8 = uniq.find((u) => /\.m3u8($|\?)/i.test(u));
  if (m3u8) {
    const ua = navigator?.userAgent || "";
    const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg/i.test(ua);
    if (isSafari) return m3u8;
  }

  return "";
}

function tiktokLiveCover(item) {
  return item?.cover?.url_list?.[0] || item?.owner?.avatar_thumb?.url_list?.[0] || "";
}

function tiktokLiveViewers(item) {
  return item?.stats?.total_user ?? item?.user_count ?? null;
}

/** Preferred key order; unknown keys sort after these, alphabetically */
const BRIGHT_DATA_KEY_ORDER = [
  "title", "name",
  "post_url", "tiktok_post_url", "video_post_url", "advertising_post_url", "tiktok_video_url",
  // Post-oriented export
  "url", "profile_url", "account_id", "profile_username", "profile_id", "secu_id", "region",
  "create_time", "post_id", "shortcode", "post_type", "is_verified",
  "play_count", "digg_count", "comment_count", "share_count", "collect_count", "ratio",
  "description", "hashtags", "tagged_user",
  "preview_image", "carousel_images",
  "music", "original_sound", "original_item", "offical_item",
  "video_url", "cdn_link", "cdn_url", "video_duration", "width",
  // Older product export
  "product_url", "video_link", "videos", "category_url", "domain", "category",
  "currency", "final_price", "initial_price", "discount_percent",
  "final_price_high", "final_price_low", "initial_price_high", "initial_price_low",
  "shipping_fee", "In_stock", "available", "sold", "position",
  "prodct_rating", "reviews_count", "seller_id", "description", "colors",
  "specifications", "variations", "reviews", "related_videos", "Shop_performance_metrics",
  "store_details", "promotion_items", "images", "desc_detail",
  // Legacy ingestion shape
  "product_id", "external_id", "brand", "source", "source_entity_type",
  "freshness_status", "freshness_age_hours", "validation_status",
  "observed_at", "fetched_at", "parser_version", "evidence", "sourceability_summary", "trend_summary", "tiktok_shop", "post_demand",
];

function brightDataSortedKeys(obj) {
  const keys = Object.keys(obj || {});
  const rank = new Map(BRIGHT_DATA_KEY_ORDER.map((k, i) => [k, i]));
  return keys.sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : 1000;
    const rb = rank.has(b) ? rank.get(b) : 1000;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

function brightDataTryPrettyJsonString(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  try {
    return JSON.parse(s);
  } catch (_e) {
    return null;
  }
}

function BrightDataScalarMetrics({ entries }) {
  return (
    <div className="metrics-grid wide bright-scalar-grid">
      {entries.map(([k, v]) => (
        <Metric key={k} label={brightDataLabel(k)} value={formatBrightScalarForMetric(v)} />
      ))}
    </div>
  );
}

function formatBrightScalarForMetric(v) {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string") {
    if (/^https?:\/\//i.test(v)) return "URL";
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}|\s)/.test(v)) {
      try {
        const d = new Date(v);
        if (!isNaN(d)) return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      } catch (_) {}
    }
    return v.length > 48 ? `${v.slice(0, 48)}…` : v;
  }
  return String(v);
}

function BrightDataFieldBlock({ fieldKey, value, depth }) {
  if (!brightDataIsPresent(value)) return null;

  if (typeof value === "string") {
    if (fieldKey === "desc_detail") {
      const parsed = brightDataTryPrettyJsonString(value);
      return parsed != null ? (
        <pre className="json-block">{JSON.stringify(parsed, null, 2)}</pre>
      ) : (
        <pre className="json-block">{value}</pre>
      );
    }
    return <p className="bright-prose">{value}</p>;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <div className="metrics-grid wide">
        <Metric label={brightDataLabel(fieldKey)} value={typeof value === "boolean" ? (value ? "yes" : "no") : String(value)} />
      </div>
    );
  }

  if (Array.isArray(value)) {
    return <BrightDataArrayValue fieldKey={fieldKey} value={value} depth={depth} />;
  }

  if (typeof value === "object") {
    return <BrightDataObjectValue value={value} depth={depth + 1} />;
  }

  return <p className="dim small">{String(value)}</p>;
}

function brightFormatVariationOptions(v) {
  const props = toArray(v?.sku_sales_props);
  if (props.length === 0) return "—";
  return props.map((p) => `${brightDataLabel(p?.name || "Option")}: ${p?.value != null ? String(p.value) : "—"}`).join(" · ");
}

function BrightVariationsList({ items }) {
  return (
    <div className="bright-variations-wrap">
      <table className="bright-variations-table">
        <thead>
          <tr>
            <th className="col-thumb" aria-label="Preview" />
            <th className="col-variant">Variant</th>
            <th className="col-sku">SKU</th>
            <th className="col-price">Price</th>
            <th className="col-stock">Stock</th>
            <th className="col-limit">Limit</th>
          </tr>
        </thead>
        <tbody>
          {items.map((v, rowIdx) => {
            const currency = v?.currency || "USD";
            const finalLabel = formatPrice(v?.final_price, currency);
            const initialLabel = formatPrice(v?.initial_price, currency);
            const showStrike = brightDataIsPresent(v?.initial_price) && brightDataIsPresent(v?.final_price)
              && Number(v.initial_price) !== Number(v.final_price);
            const disc = v?.discount_percent != null ? Number(v.discount_percent) : null;
            return (
              <tr key={v?.sku ?? rowIdx}>
                <td className="col-thumb">
                  {v?.image ? (
                    <img className="bright-var-thumb" src={v.image} alt="" loading="lazy" />
                  ) : (
                    <div className="bright-var-thumb bright-var-thumb--empty" aria-hidden="true">—</div>
                  )}
                </td>
                <td className="col-variant">{brightFormatVariationOptions(v)}</td>
                <td className="col-sku"><code>{v?.sku != null ? String(v.sku) : "—"}</code></td>
                <td className="col-price">
                  <div className="bright-var-price">
                    {finalLabel ? <span className="bright-var-price-final">{finalLabel}</span> : <span className="dim">—</span>}
                    {showStrike && initialLabel ? (
                      <span className="bright-var-price-initial">{initialLabel}</span>
                    ) : null}
                    {disc != null && disc > 0 ? <span className="pill soft">{disc}% off</span> : null}
                  </div>
                </td>
                <td className="col-stock">{v?.stock != null ? compactNumber(v.stock) : "—"}</td>
                <td className="col-limit">{v?.purchase_limit != null ? String(v.purchase_limit) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="dim small bright-variations-foot">{items.length} variation{items.length === 1 ? "" : "s"}</p>
    </div>
  );
}

function BrightDataArrayValue({ fieldKey, value, depth }) {
  const arr = toArray(value);
  if (arr.length === 0) return null;

  if (fieldKey === "videos") {
    const links = arr.filter((x) => typeof x === "string" && /^https?:\/\//i.test(String(x).trim()));
    if (links.length === 0) return <p className="dim small">No video URLs in this array.</p>;
    return (
      <ul className="list bright-video-url-list">
        {links.map((href, i) => (
          <li key={i}>
            <a className="link-btn" href={String(href).trim()} target="_blank" rel="noopener noreferrer">
              Video {links.length > 1 ? `${i + 1} ` : ""}↗
            </a>
          </li>
        ))}
      </ul>
    );
  }

  const first = arr[0];
  if (first && typeof first === "object") {
    if (("kind" in first || "label" in first) && "value" in first) {
      return (
        <ul className="list evidence-list">
          {arr.map((ev, i) => (
            <li key={i}>
              <strong>{ev?.label || ev?.kind || "Evidence"}</strong>
              {ev?.value != null && ev?.value !== "" ? <span className="evidence-value">: {String(ev.value)}</span> : null}
              {ev?.source ? <span className="evidence-meta"> · {String(ev.source)}</span> : null}
              {ev?.observedAt ? <span className="evidence-meta"> · {new Date(ev.observedAt).toLocaleString()}</span> : null}
            </li>
          ))}
        </ul>
      );
    }
    if ("metric" in first && "value" in first) {
      return (
        <table className="bright-kv-table">
          <tbody>
            {arr.map((row, i) => (
              <tr key={i}>
                <td>{row?.metric != null ? String(row.metric) : "—"}</td>
                <td>{row?.value != null ? String(row.value) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if ("title" in first && "value" in first && !("review" in first)) {
      return (
        <table className="bright-kv-table">
          <tbody>
            {arr.map((row, i) => (
              <tr key={i}>
                <td>{row?.title != null ? String(row.title) : "—"}</td>
                <td>{row?.value != null ? String(row.value) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (fieldKey === "reviews" || ("name" in first && "review" in first)) {
      return (
        <ul className="list bright-review-list">
          {arr.map((r, i) => (
            <li key={i}>
              <strong>{r?.name || "Review"}</strong>
              {r?.rating != null ? <span className="dim small"> · {String(r.rating)}★</span> : null}
              {r?.date ? <span className="dim small"> · {new Date(r.date).toLocaleString()}</span> : null}
              {r?.review && String(r.review).trim() ? <p className="bright-review-text">{String(r.review).trim()}</p> : null}
            </li>
          ))}
        </ul>
      );
    }
    if (fieldKey === "related_videos" || ("link" in first && "user_name" in first)) {
      return (
        <ul className="list">
          {arr.map((rv, i) => (
            <li key={i}>
              {rv?.user_name ? <strong>{rv.user_name}</strong> : null}
              {rv?.likes != null ? <span className="dim small"> · {compactNumber(rv.likes)} likes</span> : null}
              {rv?.link ? (
                <>
                  {" "}
                  <a className="link-btn" href={rv.link} target="_blank" rel="noopener noreferrer">Video ↗</a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      );
    }
    if (fieldKey === "variations") {
      return <BrightVariationsList items={arr} />;
    }
  }

  if (typeof first === "string" || typeof first === "number" || typeof first === "boolean") {
    return (
      <div className="tag-row">
        {arr.map((x, i) => (
          <span className="tag" key={i}>{String(x)}</span>
        ))}
      </div>
    );
  }

  return <pre className="json-block">{JSON.stringify(arr, null, 2)}</pre>;
}

function BrightDataObjectValue({ value, depth }) {
  if (depth > 5) {
    return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
  }
  const entries = Object.entries(value).filter(([, v]) => brightDataIsPresent(v));
  if (entries.length === 0) return null;

  const scalars = [];
  const nested = [];
  for (const [k, v] of entries) {
    if (v !== null && v !== undefined && typeof v !== "object") {
      scalars.push([k, v]);
    } else {
      nested.push([k, v]);
    }
  }

  return (
    <div className="bright-nested-object">
      {scalars.length > 0 ? <BrightDataScalarMetrics entries={scalars} /> : null}
      {nested.map(([k, v]) => (
        <div className="bright-nested-block" key={k}>
          <div className="bright-nested-label">{brightDataLabel(k)}</div>
          <BrightDataFieldBlock fieldKey={k} value={v} depth={depth} />
        </div>
      ))}
    </div>
  );
}
function productImage(item) {
  if (!item) return "";
  return item.primaryImageUrl
    || (Array.isArray(item.imageUrls) && item.imageUrls.find(Boolean))
    || item.thumbnailUrl
    || "";
}
function creativeImage(item) {
  if (!item) return "";
  return item.thumbnailUrl || item.videoCoverUrl || item.coverUrl || item?.creator?.avatarUrl || "";
}
function pageCount(pagination) {
  if (!pagination) return 1;
  if (pagination.pages) return pagination.pages;
  const limit = pagination.limit || 20;
  const total = pagination.total || 0;
  return Math.max(1, Math.ceil(total / limit));
}
function paginationLabel(pagination) {
  if (!pagination) return "Page 1";
  const page = pagination.page ?? 1;
  return `Page ${page} of ${pageCount(pagination)} · ${pagination.total ?? "?"} results`;
}

function App() {
  const [page, setPage] = useState(() => {
    const saved = localStorage.getItem("app.page");
    return NAV.includes(saved) ? saved : "Shopify Search";
  });
  useEffect(() => { localStorage.setItem("app.page", page); }, [page]);
  const [backendUrl, setBackendUrl] = useState(localStorage.getItem("app.backendUrl") || "http://localhost:3000");
  const [apiVersion, setApiVersion] = useState(localStorage.getItem("app.apiVersion") || "v1");
  const [token, setToken] = useState(localStorage.getItem("app.token") || "");
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [internalApiKey, setInternalApiKey] = useState(localStorage.getItem("app.internalApiKey") || "");

  const [me, setMe] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [plans, setPlans] = useState([]);
  const [planMode, setPlanMode] = useState("test");
  const [categories, setCategories] = useState([]);

  const [products, setProducts] = useState([]);
  const [productsPagination, setProductsPagination] = useState(null);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState("");
  const [creatives, setCreatives] = useState([]);
  const [creativesPagination, setCreativesPagination] = useState(null);
  const [creativesLoading, setCreativesLoading] = useState(false);
  const [creativesError, setCreativesError] = useState("");
  const [bookmarks, setBookmarks] = useState([]);
  const [detailProduct, setDetailProduct] = useState(null);
  const [detailCreative, setDetailCreative] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [shopifyResults, setShopifyResults] = useState([]);
  const [shopifyCount, setShopifyCount] = useState(0);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError, setShopifyError] = useState("");
  const [brightDataProducts, setBrightDataProducts] = useState([]);
  const [brightDataMeta, setBrightDataMeta] = useState({ exportedAt: "", totalProducts: 0, totalRecords: 0 });
  const [brightDataLoading, setBrightDataLoading] = useState(false);
  const [brightDataError, setBrightDataError] = useState("");
  const [detailBrightDataProduct, setDetailBrightDataProduct] = useState(null);
  const [tiktokLives, setTiktokLives] = useState([]);
  const [tiktokLiveLoading, setTiktokLiveLoading] = useState(false);
  const [tiktokLiveError, setTiktokLiveError] = useState("");
  const [liveEndedHandles, setLiveEndedHandles] = useState([]);

  // ── Shopify store integration ────────────────────────────────────────────
  const [shopifyConnection, setShopifyConnection] = useState(null);
  const [shopifyConfigured, setShopifyConfigured] = useState(true);
  const [shopifyConnectLoading, setShopifyConnectLoading] = useState(false);
  const [shopifyConnectError, setShopifyConnectError] = useState("");
  const [shopifyNotice, setShopifyNotice] = useState(null); // { kind: 'success'|'error', message }
  const [shopifyPushing, setShopifyPushing] = useState(false);

  const apiBase = useMemo(() => `${backendUrl.replace(/\/+$/, "")}/api/${apiVersion}`, [backendUrl, apiVersion]);

  useEffect(() => {
    localStorage.setItem("app.backendUrl", backendUrl);
    localStorage.setItem("app.apiVersion", apiVersion);
  }, [backendUrl, apiVersion]);
  useEffect(() => {
    if (token) localStorage.setItem("app.token", token);
    else localStorage.removeItem("app.token");
  }, [token]);
  useEffect(() => {
    if (internalApiKey) localStorage.setItem("app.internalApiKey", internalApiKey);
    else localStorage.removeItem("app.internalApiKey");
  }, [internalApiKey]);

  async function request(path, options = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${apiBase}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const parsed = toJsonSafe(await res.text());
    if (!res.ok) throw new Error(parsed?.message || `${res.status} ${res.statusText}`);
    return parsed;
  }

  async function run(label, fn) {
    setBusy(true);
    setError("");
    setStatus(`${label}...`);
    try {
      await fn();
      setStatus(label);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function loadBootstrap() {
    await run("Loaded", async () => {
      const [plansRes, categoriesRes] = await Promise.all([
        request("/billing/plans").catch((e) => ({ __err: e })),
        request("/products/categories").catch(() => null),
      ]);
      if (plansRes && !plansRes.__err) {
        const d = data(plansRes);
        setPlans(toArray(d?.plans));
        setPlanMode(d?.mode || "test");
      }
      if (categoriesRes) {
        const cats = data(categoriesRes)?.categories;
        setCategories(toArray(cats));
      }
    });
  }

  async function refreshSession() {
    if (!token) return;
    await run("Session refreshed", async () => {
      const [meRes, subRes] = await Promise.all([
        request("/auth/me").catch(() => null),
        request("/billing/subscription").catch(() => null),
      ]);
      if (meRes) setMe(data(meRes)?.user || data(meRes));
      if (subRes) setSubscription(data(subRes));
    });
  }

  useEffect(() => { loadBootstrap(); }, []);
  useEffect(() => { refreshSession(); }, [token]);

  async function signIn(email, password) {
    await run("Signed in", async () => {
      const res = await request("/auth/login", { method: "POST", body: { email, password } });
      const d = data(res);
      if (d?.token) setToken(d.token);
      if (d?.user) setMe(d.user);
    });
  }
  async function register(email) {
    await run("Verification code sent", async () => {
      await request("/auth/register", { method: "POST", body: { email } });
    });
  }
  async function verify(email, code, password, name) {
    await run("Account verified — you can sign in now", async () => {
      await request("/auth/email/verify-code", { method: "POST", body: { email, code, password, name } });
    });
  }
  async function signOut() {
    await run("Signed out", async () => {
      try { await request("/auth/logout", { method: "POST" }); } catch (_e) {}
      setToken("");
      setMe(null);
      setSubscription(null);
      setBookmarks([]);
    });
  }

  async function searchProducts(query) {
    setProductsLoading(true); setProductsError("");
    try {
      const qs = new URLSearchParams(query).toString();
      const res = await request(`/products?${qs}`);
      const p = normalizeList(res, ["products"]);
      setProducts(p.items);
      setProductsPagination(p.pagination);
      setStatus("Products updated");
    } catch (err) {
      setProductsError(String(err?.message || err));
    } finally {
      setProductsLoading(false);
    }
  }
  async function searchCreatives(query) {
    setCreativesLoading(true); setCreativesError("");
    try {
      const qs = new URLSearchParams(query).toString();
      const res = await request(`/creatives?${qs}`);
      const c = normalizeList(res, ["creatives", "data"]);
      setCreatives(c.items);
      setCreativesPagination(c.pagination);
      setStatus("Creatives updated");
    } catch (err) {
      setCreativesError(String(err?.message || err));
    } finally {
      setCreativesLoading(false);
    }
  }
  async function loadCreatorsFromDb(force = false) {
    if (!force && creatives.length > 0) return;
    await searchCreatives({ page: 1, limit: 30, sortBy: "views" });
  }
  async function openProduct(id) {
    if (!id) return;
    setDetailProduct({ __loading: true });
    setDetailLoading(true);
    try {
      const res = await request(`/products/${id}`);
      setDetailProduct(data(res)?.product || data(res));
    } catch (err) {
      setDetailProduct({ __error: String(err?.message || err) });
    } finally {
      setDetailLoading(false);
    }
  }
  async function openCreative(id) {
    if (!id) return;
    setDetailCreative({ __loading: true });
    setDetailLoading(true);
    try {
      const res = await request(`/creatives/${id}`);
      setDetailCreative(data(res)?.creative || data(res));
    } catch (err) {
      setDetailCreative({ __error: String(err?.message || err) });
    } finally {
      setDetailLoading(false);
    }
  }
  async function beginCheckout(plan) {
    if (!token) {
      setPage("Account");
      setError("Sign in to start checkout.");
      return;
    }
    await run("Opening Stripe checkout", async () => {
      const res = await request("/billing/checkout", {
        method: "POST",
        body: {
          plan,
          successUrl: `${window.location.origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/pricing`,
        },
      });
      const url = data(res)?.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
  }
  async function loadBookmarks() {
    await run("Saved products loaded", async () => {
      const res = await request("/profile/bookmarks");
      const d = data(res);
      setBookmarks(toArray(d?.bookmarks || d?.data || d));
    });
  }
  async function searchShopify(productName) {
    setShopifyLoading(true);
    setShopifyError("");
    try {
      if (!internalApiKey) throw new Error("Set Internal API Key in settings first.");
      const res = await fetch(`${apiBase}/scrapers/get-product-name`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": internalApiKey,
        },
        body: JSON.stringify({ productName }),
      });
      const parsed = toJsonSafe(await res.text());
      if (!res.ok) {
        const msg = parsed?.error?.message || parsed?.message || `${res.status} ${res.statusText}`;
        throw new Error(msg);
      }
      const payload = data(parsed);
      const items = toArray(payload?.data);
      setShopifyResults(items);
      setShopifyCount(payload?.count ?? items.length);
      setStatus("Shopify search completed");
    } catch (err) {
      setShopifyResults([]);
      setShopifyCount(0);
      setShopifyError(String(err?.message || err));
    } finally {
      setShopifyLoading(false);
    }
  }
  async function loadBrightDataProducts(force = false) {
    if (brightDataLoading) return;
    if (!force && brightDataProducts.length > 0) return;
    setBrightDataLoading(true);
    setBrightDataError("");
    try {
      const res = await request("/products?page=1&limit=100");
      const normalized = normalizeList(res, ["products", "data"]);
      const sourceList = toArray(normalized.items);
      const products = sourceList.map(normalizeDbProductRecord).filter(Boolean);
      const totalRecords = normalized.pagination?.total ?? sourceList.length;
      const exportedAt = sourceList
        .map((p) => p?.dataSourceUpdatedAt || p?.lastIngestedAt || null)
        .find(Boolean) || "";

      setBrightDataProducts(products);
      setBrightDataMeta({
        exportedAt,
        totalProducts: products.length,
        totalRecords,
      });
      if (products.length === 0) {
        setBrightDataError("Loaded products from DB, but no products were found.");
      }
      setStatus("Products loaded from DB");
    } catch (err) {
      setBrightDataProducts([]);
      setBrightDataMeta({ exportedAt: "", totalProducts: 0, totalRecords: 0 });
      setBrightDataError(String(err?.message || err));
    } finally {
      setBrightDataLoading(false);
    }
  }
  async function loadTikTokLiveDiscover() {
    setTiktokLiveLoading(true);
    setTiktokLiveError("");
    try {
      const res = await request("/tiktok/live/discover");
      const payload = data(res);
      setTiktokLives(toArray(payload?.live));
      setLiveEndedHandles(toArray(payload?.ended));
      const liveCount = payload?.liveCount ?? 0;
      const checked = payload?.totalChecked ?? 0;
      setStatus(checked === 0
        ? "Watchlist is empty — add stores to track"
        : `${liveCount} of ${checked} store${checked !== 1 ? "s" : ""} live`);
    } catch (err) {
      setTiktokLives([]);
      setTiktokLiveError(String(err?.message || err));
    } finally {
      setTiktokLiveLoading(false);
    }
  }

  useEffect(() => {
    if (page === "TikTok Live" && token) {
      loadTikTokLiveDiscover();
    }
  }, [page]);
  useEffect(() => {
    if (page === "Bright data products") loadBrightDataProducts();
  }, [page]);
  useEffect(() => {
    if (page === "Creators") loadCreatorsFromDb();
  }, [page]);
  async function addBookmark(productId) {
    if (!productId) return;
    await run("Saved to library", async () => {
      await request("/profile/bookmarks", { method: "POST", body: { productId } });
      if (token) await loadBookmarks();
    });
  }

  // ── Shopify: load connection status ────────────────────────────────────────
  async function loadShopifyStatus() {
    if (!token) {
      setShopifyConnection(null);
      return;
    }
    try {
      const res = await request("/stores/shopify/status");
      const d = data(res);
      setShopifyConnection(d?.connection || null);
      setShopifyConfigured(d?.shopifyConfigured !== false);
    } catch (err) {
      setShopifyConnection(null);
      setShopifyConnectError(String(err?.message || err));
    }
  }

  // Load status when the user signs in or opens the page
  useEffect(() => {
    if (token) loadShopifyStatus();
    else setShopifyConnection(null);
  }, [token]);
  useEffect(() => {
    if (page === "My Shopify" && token) loadShopifyStatus();
  }, [page]);

  // Detect OAuth callback (?status=success|error&shop=&code=&message=) on mount
  // and surface the result on the Shopify page.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const status = params.get("status");
      if (!status) return;
      const shop = params.get("shop") || "";
      const message = params.get("message") || "";
      const code = params.get("code") || "";
      if (status === "success") {
        setShopifyNotice({
          kind: "success",
          message: `Shopify store ${shop || ""} connected successfully.`,
        });
        setPage("My Shopify");
        if (token) loadShopifyStatus();
      } else if (status === "error") {
        setShopifyNotice({
          kind: "error",
          message: `Shopify connection failed${code ? ` (${code})` : ""}: ${message || "Unknown error"}`,
        });
        setPage("My Shopify");
      }
      // Strip the params from the URL so the message doesn't keep re-appearing
      const url = new URL(window.location.href);
      ["status", "shop", "message", "code"].forEach((k) => url.searchParams.delete(k));
      window.history.replaceState({}, document.title, url.toString());
    } catch (_e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shopify: start OAuth connect (or send to signup) ───────────────────────
  async function connectShopify(shopInput) {
    if (!token) {
      setPage("Account");
      setError("Sign in to connect your Shopify store.");
      return;
    }
    setShopifyConnectLoading(true);
    setShopifyConnectError("");
    setShopifyNotice(null);
    try {
      const cleaned = String(shopInput || "").trim();
      const qs = cleaned ? `?shop=${encodeURIComponent(cleaned)}` : "";
      const res = await request(`/stores/shopify/install${qs}`);
      const d = data(res);

      if (d?.action === "signup" && d?.signupUrl) {
        window.open(d.signupUrl, "_blank", "noopener,noreferrer");
        setShopifyNotice({
          kind: "info",
          message:
            "Opening Shopify signup in a new tab. Once you've created your store, come back here and paste your shop domain to connect.",
        });
        return;
      }
      if (d?.action === "connect" && d?.authorizeUrl) {
        // Same-tab redirect so the user lands back on this app after the OAuth dance.
        window.location.href = d.authorizeUrl;
        return;
      }
      throw new Error("Unexpected response from /stores/shopify/install");
    } catch (err) {
      setShopifyConnectError(String(err?.message || err));
    } finally {
      setShopifyConnectLoading(false);
    }
  }

  async function disconnectShopify() {
    if (!token) return;
    setShopifyConnectLoading(true);
    setShopifyConnectError("");
    try {
      await request("/stores/shopify/disconnect", { method: "POST" });
      setShopifyConnection(null);
      setShopifyNotice({ kind: "success", message: "Shopify store disconnected." });
    } catch (err) {
      setShopifyConnectError(String(err?.message || err));
    } finally {
      setShopifyConnectLoading(false);
    }
  }

  // ── Shopify: push a DB product to the connected store ──────────────────────
  async function pushProductToShopify(productId, opts = {}) {
    if (!token) {
      setError("Sign in to push products to your Shopify store.");
      setPage("Account");
      return null;
    }
    if (!productId) {
      setError("This product can't be pushed — it isn't a saved DB product (missing id).");
      return null;
    }
    setShopifyPushing(true);
    try {
      const body = { productId };
      if (opts.price != null && opts.price !== "") body.price = Number(opts.price);
      if (opts.status) body.status = opts.status;
      const res = await request("/stores/shopify/products", { method: "POST", body });
      const created = data(res)?.product;
      setStatus(`Pushed to Shopify (#${created?.id})`);
      setShopifyNotice({
        kind: "success",
        message: `Product pushed to Shopify as "${created?.handle || created?.id}" (${created?.status}).`,
      });
      return created;
    } catch (err) {
      const msg = String(err?.message || err);
      if (/SHOPIFY_NOT_CONNECTED|not connected/i.test(msg)) {
        setShopifyNotice({
          kind: "error",
          message: "Connect your Shopify store first.",
        });
        setPage("My Shopify");
      } else {
        setError(`Push to Shopify failed: ${msg}`);
      }
      return null;
    } finally {
      setShopifyPushing(false);
    }
  }

  return (
    <div className="app">
      <TopBar
        page={page} setPage={setPage}
        me={me} subscription={subscription}
        showSettings={showSettings} setShowSettings={setShowSettings}
        backendUrl={backendUrl} setBackendUrl={setBackendUrl}
        apiVersion={apiVersion} setApiVersion={setApiVersion}
        internalApiKey={internalApiKey} setInternalApiKey={setInternalApiKey}
        apiBase={apiBase} planMode={planMode}
      />

      <main className="main">
        {page === "Shopify Search" && (
          <ShopifySearchPage
            loading={shopifyLoading}
            error={shopifyError}
            results={shopifyResults}
            count={shopifyCount}
            onSearch={searchShopify}
          />
        )}
        {page === "Bright data products" && (
          <BrightDataProductsPage
            products={brightDataProducts}
            meta={brightDataMeta}
            loading={brightDataLoading}
            error={brightDataError}
            onRefresh={() => loadBrightDataProducts(true)}
            onOpenProduct={setDetailBrightDataProduct}
          />
        )}
        {page === "TikTok Live" && (
          <TikTokLivePage
            loading={tiktokLiveLoading}
            lives={tiktokLives}
            error={tiktokLiveError}
            onDiscover={loadTikTokLiveDiscover}
          />
        )}
        {page === "Creators" && (
          <CreatorsPage
            loading={creativesLoading}
            creatives={creatives}
            error={creativesError}
            onRefresh={() => loadCreatorsFromDb(true)}
            backendUrl={backendUrl}
          />
        )}
        {page === "Pricing" && (
          <PricingPage plans={plans} planMode={planMode} subscription={subscription} onCheckout={beginCheckout} />
        )}
        {page === "My Shopify" && (
          <ShopifyPage
            token={token}
            connection={shopifyConnection}
            configured={shopifyConfigured}
            loading={shopifyConnectLoading}
            error={shopifyConnectError}
            notice={shopifyNotice}
            onConnect={connectShopify}
            onDisconnect={disconnectShopify}
            onRefresh={loadShopifyStatus}
            onDismissNotice={() => setShopifyNotice(null)}
            onGoSignIn={() => setPage("Account")}
          />
        )}
        {page === "Account" && (
          <AccountPage
            token={token} me={me} subscription={subscription} bookmarks={bookmarks}
            onRegister={register} onVerify={verify}
            onSignIn={signIn} onSignOut={signOut}
            onLoadBookmarks={loadBookmarks}
            onOpenProduct={openProduct}
          />
        )}
      </main>

      <footer className="statusbar">
        <span>{busy ? "Working..." : status}</span>
        {error ? <span className="error">{error}</span> : <span className="dim">{apiBase}</span>}
      </footer>

      {detailProduct && (
        <ProductModal
          product={detailProduct}
          onClose={() => setDetailProduct(null)}
          onBookmark={addBookmark}
          tokenPresent={Boolean(token)}
          backendUrl={backendUrl}
          loading={detailLoading}
          shopifyConnected={Boolean(shopifyConnection)}
          shopifyPushing={shopifyPushing}
          onPushToShopify={pushProductToShopify}
          onGoShopify={() => { setDetailProduct(null); setPage("My Shopify"); }}
        />
      )}
      {detailCreative && (
        <CreativeModal creative={detailCreative} onClose={() => setDetailCreative(null)} backendUrl={backendUrl} loading={detailLoading} />
      )}
      {detailBrightDataProduct && (
        <BrightDataProductModal
          product={detailBrightDataProduct}
          onClose={() => setDetailBrightDataProduct(null)}
          tokenPresent={Boolean(token)}
          shopifyConnected={Boolean(shopifyConnection)}
          shopifyPushing={shopifyPushing}
          onPushToShopify={pushProductToShopify}
          onGoShopify={() => { setDetailBrightDataProduct(null); setPage("My Shopify"); }}
        />
      )}
    </div>
  );
}

// ── Top Bar ──────────────────────────────────────────────────────────────────

function TopBar({ page, setPage, me, subscription, showSettings, setShowSettings, backendUrl, setBackendUrl, apiVersion, setApiVersion, internalApiKey, setInternalApiKey, apiBase, planMode }) {
  return (
    <header className="topbar">
      <div className="brand" onClick={() => setPage("Shopify Search")}>
        <div className="brand-mark">V</div>
        <div>
          <div className="brand-title">ValidDs</div>
          <div className="brand-sub">TikTok Shop product & creative intelligence</div>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((item) => (
          <button key={item} className={item === page ? "nav-btn active" : "nav-btn"} onClick={() => setPage(item)}>
            {item}
          </button>
        ))}
      </nav>

      <div className="top-actions">
        <span className={`mode-pill ${planMode === "live" ? "live" : "test"}`}>{planMode === "live" ? "LIVE" : "TEST"}</span>
        <button className="icon-btn" title="API settings" onClick={() => setShowSettings((s) => !s)}>⚙︎</button>
        {me ? (
          <div className="user-chip">
            <span className="avatar">{(me.name || me.email || "?").slice(0, 1).toUpperCase()}</span>
            <div className="user-meta">
              <div className="name">{me.name || me.email}</div>
              <div className="plan">{subscription?.plan || "free"}</div>
            </div>
          </div>
        ) : (
          <button className="primary" onClick={() => setPage("Account")}>Sign in</button>
        )}
      </div>

      {showSettings && (
        <div className="settings-drawer">
          <label>Backend URL<input value={backendUrl} onChange={(e) => setBackendUrl(e.target.value)} /></label>
          <label>API version<input value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} /></label>
          <label>Internal API key<input value={internalApiKey} onChange={(e) => setInternalApiKey(e.target.value)} placeholder="Required for /scrapers endpoint" /></label>
          <p className="dim small">Calls go to: {apiBase}</p>
        </div>
      )}
    </header>
  );
}

// ── Discover / Home ──────────────────────────────────────────────────────────

function DiscoverPage({ me, subscription, products, creatives, plans, productsLoading, creativesLoading, productsError, creativesError, onRetry, backendUrl, onGoTo, onOpenProduct, onOpenCreative, onBookmark, tokenPresent }) {
  const topTrending = toArray(products).slice(0, 6);
  const topCreatives = toArray(creatives).slice(0, 6);
  return (
    <div className="discover">
      <section className="hero">
        <div className="hero-text">
          <h1>Spot the next winning TikTok Shop product before everyone else.</h1>
          <p>ValidDs watches real TikTok posts, ads, and shop metrics to surface the products and creatives that are actually converting — with the trend, engagement, and supplier evidence to back it up.</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => onGoTo("Products")}>Browse products</button>
            <button onClick={() => onGoTo("Creatives")}>Explore creatives</button>
          </div>
        </div>
        <div className="hero-stats">
          <Stat label="Signed in as" value={me?.email || "Guest"} />
          <Stat label="Current plan" value={subscription?.plan || "free"} />
          <Stat label="Credits left" value={subscription?.creditBalance != null ? compactNumber(subscription.creditBalance) : "-"} />
          <Stat label="Products loaded" value={compactNumber(products.length)} />
        </div>
      </section>

      <section>
        <SectionHeader title="Trending now" subtitle="Highest composite trend score this cycle" action={<button onClick={() => onGoTo("Products")}>See all products →</button>} />
        <ErrorBanner message={productsError} onRetry={onRetry} />
        <div className="grid products-grid">
          {productsLoading && topTrending.length === 0 ? (
            <GridSkeleton count={6} tall />
          ) : topTrending.length === 0 && !productsError ? (
            <EmptyState text="No products yet. Run ingestion from the backend, then refresh." />
          ) : (
            topTrending.map((p, i) => (
              <ProductCard key={p?._id || i} product={p} onOpen={onOpenProduct} onBookmark={onBookmark} tokenPresent={tokenPresent} backendUrl={backendUrl} />
            ))
          )}
        </div>
      </section>

      <section>
        <SectionHeader title="Hot creatives" subtitle="Latest ads & organic videos fuelling sales" action={<button onClick={() => onGoTo("Creatives")}>See all creatives →</button>} />
        <ErrorBanner message={creativesError} onRetry={onRetry} />
        <div className="grid creatives-grid">
          {creativesLoading && topCreatives.length === 0 ? (
            <GridSkeleton count={6} />
          ) : topCreatives.length === 0 && !creativesError ? (
            <EmptyState text="No creatives loaded yet." />
          ) : (
            topCreatives.map((c, i) => (
              <CreativeCard key={c?._id || i} creative={c} onOpen={onOpenCreative} backendUrl={backendUrl} />
            ))
          )}
        </div>
      </section>

      <section>
        <SectionHeader title="Upgrade when you're ready" subtitle="Every plan unlocks more discovery credits & deeper signals." action={<button onClick={() => onGoTo("Pricing")}>Compare plans →</button>} />
        <div className="grid plans-grid">
          {toArray(plans).slice(0, 4).map((plan) => <MiniPlanCard key={plan.id} plan={plan} />)}
        </div>
      </section>
    </div>
  );
}

// ── Products ─────────────────────────────────────────────────────────────────

function ProductsPage({ products, pagination, categories, loading, error, backendUrl, onSearch, onBookmark, onOpenProduct, tokenPresent }) {
  const [filters, setFilters] = useState({
    q: "", page: "1", limit: "20",
    category: "", trendDirection: "", minTrendScore: "", minViews: "",
    section: "", sortBy: "trendScore", region: "",
  });
  const clean = (obj) => {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => { if (v !== "" && v != null) out[k] = v; });
    return out;
  };
  const pageNum = Number(filters.page || "1");
  const maxPages = pageCount(pagination);

  function setAndSearch(patch) {
    const next = { ...filters, ...patch };
    setFilters(next);
    onSearch(clean(next));
  }
  function setFilter(patch) { setFilters({ ...filters, ...patch }); }
  function submit() { setAndSearch({ page: "1" }); }
  function goto(n) { setAndSearch({ page: String(Math.min(Math.max(1, n), maxPages)) }); }

  return (
    <div className="page-shell">
      <SectionHeader
        title="Product discovery"
        subtitle="Search by keyword, filter by category, region and trend signals. Every card shows the full evidence we collected."
      />

      <div className="filter-panel">
        <div className="filter-row wide">
          <input placeholder="Search products by title, description, hashtag..." value={filters.q} onChange={(e) => setFilter({ q: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          <button className="primary" onClick={submit}>Search</button>
        </div>
        <div className="filter-row">
          <select value={filters.category} onChange={(e) => setAndSearch({ category: e.target.value, page: "1" })}>
            <option value="">All categories</option>
            {toArray(categories).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filters.section} onChange={(e) => setAndSearch({ section: e.target.value, page: "1" })}>
            <option value="">All discovery sections</option>
            {PRODUCT_SECTIONS.map((s) => <option key={s} value={s}>{SECTION_LABEL[s] || s}</option>)}
          </select>
          <select value={filters.trendDirection} onChange={(e) => setAndSearch({ trendDirection: e.target.value, page: "1" })}>
            <option value="">Any trend direction</option>
            <option value="rising">Rising</option>
            <option value="peaked">Peaked</option>
            <option value="saturating">Saturating</option>
            <option value="unknown">Unknown</option>
          </select>
          <select value={filters.sortBy} onChange={(e) => setAndSearch({ sortBy: e.target.value, page: "1" })}>
            <option value="trendScore">Sort: Trend score</option>
            <option value="views">Sort: Views</option>
            <option value="engagement">Sort: Engagement</option>
            <option value="recent">Sort: Recent</option>
          </select>
          <input placeholder="Min trend score (0-100)" value={filters.minTrendScore} onChange={(e) => setFilter({ minTrendScore: e.target.value })} />
          <input placeholder="Min views" value={filters.minViews} onChange={(e) => setFilter({ minViews: e.target.value })} />
          <input placeholder="Region (US, GB...)" value={filters.region} onChange={(e) => setFilter({ region: e.target.value.toUpperCase() })} />
        </div>
      </div>

      <Pager pagination={pagination} pageNum={pageNum} maxPages={maxPages} onGoto={goto} />
      <ErrorBanner message={error} onRetry={() => onSearch(clean(filters))} />

      <div className="grid products-grid" aria-busy={loading}>
        {loading && toArray(products).length === 0 ? (
          <GridSkeleton count={8} tall />
        ) : toArray(products).length === 0 && !error ? (
          <EmptyState text="No products match these filters." />
        ) : (
          toArray(products).map((p, i) => (
            <ProductCard key={p?._id || i} product={p} onOpen={onOpenProduct} onBookmark={onBookmark} tokenPresent={tokenPresent} backendUrl={backendUrl} />
          ))
        )}
      </div>

      <Pager pagination={pagination} pageNum={pageNum} maxPages={maxPages} onGoto={goto} />
    </div>
  );
}

function ProductCard({ product, onOpen, onBookmark, tokenPresent, backendUrl }) {
  const img = productImage(product);
  const trend = product?.trend || {};
  const ai = product?.aiInsight?.confidence || {};
  const sentiment = product?.aiInsight?.buyingSentiment || {};
  const priceDisplay = formatPrice(product?.price, product?.currency);
  const commission = product?.commissionRate != null ? `${(Number(product.commissionRate) * 100).toFixed(1)}%` : null;
  const sections = toArray(product?.discoverySections);
  const rating = product?.rating || product?.ratings;
  const reviewCount = product?.reviewCount;
  const engagement = product?.engagementRate != null ? `${Number(product.engagementRate).toFixed(2)}%` : null;
  const creator = product?.primaryCreator || {};
  const topHashtags = toArray(product?.hashtags).slice(0, 4);
  const brand = product?.aiIntelligence?.brand || null;

  return (
    <article className="card product-card">
      <button className="media-wrap" onClick={() => onOpen?.(product?._id)} aria-label="Open product">
        <MediaImage srcs={[img]} alt={product?.title || "Product"} placeholder="No image" />
        <div className="media-overlay">
          <SourcePill source={product?.source} region={product?.region} />
          {sections.includes("top-ads") ? <span className="pill hot">🔥 Top ad</span> : null}
          {trend?.isTrending ? <span className="pill accent">📈 Trending</span> : null}
        </div>
      </button>

      <div className="card-body">
        <div className="card-title-row">
          <h3 title={product?.title} className="clamp-2">{product?.title || "Untitled product"}</h3>
          {priceDisplay ? <span className="price-tag">{priceDisplay}</span> : null}
        </div>

        <div className="meta-row">
          {product?.categoryL1 ? <span className="pill">{product.categoryL1}</span> : null}
          {product?.categoryL2 ? <span className="pill soft">{product.categoryL2}</span> : null}
          {brand ? <span className="pill soft">Brand: {brand}</span> : null}
        </div>

        {product?.description ? <p className="desc clamp-3">{product.description}</p> : null}

        <div className="metrics-grid">
          <Metric label="Trend" value={`${trend?.score ?? "-"}/100`} hint={trend?.direction || "unknown"} />
          <Metric label="Views" value={compactNumber(product?.viewCount)} />
          <Metric label="Likes" value={compactNumber(product?.likeCount)} />
          <Metric label="Comments" value={compactNumber(product?.commentCount)} />
          <Metric label="Shares" value={compactNumber(product?.shareCount)} />
          <Metric label="Engagement" value={engagement || "-"} />
          {rating ? <Metric label="Rating" value={`★ ${Number(rating).toFixed(1)}`} hint={reviewCount ? `${compactNumber(reviewCount)} reviews` : null} /> : null}
          {product?.totalSale30d != null ? <Metric label="Sales 30d" value={compactNumber(product.totalSale30d)} /> : null}
          {product?.totalGmv != null ? <Metric label="GMV" value={compactNumber(product.totalGmv)} /> : null}
          {product?.totalCreators != null ? <Metric label="Creators" value={compactNumber(product.totalCreators)} /> : null}
          {commission ? <Metric label="Commission" value={commission} /> : null}
          {product?.salesChannel ? <Metric label="Channel" value={product.salesChannel} /> : null}
        </div>

        {(ai?.score != null || sentiment?.score != null) && (
          <div className="ai-row">
            {ai?.score != null ? <Bar label="AI confidence" value={Number(ai.score)} /> : null}
            {sentiment?.score != null ? <Bar label="Buying intent" value={Number(sentiment.score)} /> : null}
          </div>
        )}

        {trend?.reason ? <p className="note clamp-2" title={trend.reason}>💡 {trend.reason}</p> : null}

        {creator?.handle ? (
          <div className="creator-row">
            {creator.avatarUrl ? <img className="creator-avatar" src={creator.avatarUrl} alt={creator.handle} /> : <div className="creator-avatar placeholder">{creator.handle?.slice(0, 1).toUpperCase()}</div>}
            <div className="creator-meta">
              <div className="creator-handle">@{creator.handle}{creator.verified ? " ✓" : ""}</div>
              <div className="creator-sub">{compactNumber(creator.followers)} followers · {creator.region || "—"}</div>
            </div>
            {creator.tiktokPostUrl ? <a className="link-btn" href={creator.tiktokPostUrl} target="_blank" rel="noopener noreferrer">Open post ↗</a> : null}
          </div>
        ) : null}

        {topHashtags.length > 0 && (
          <div className="tag-row">
            {topHashtags.map((h, i) => <span className="tag" key={i}>#{String(h).replace(/^#/, "")}</span>)}
          </div>
        )}

        <div className="card-footer">
          <div className="footer-meta">
            <span className="dim small">Creatives: {product?.creativeCounts?.total ?? "-"} (ads {product?.creativeCounts?.ads ?? 0}) </span>
          </div>
          <div className="actions">
            <button onClick={() => onOpen?.(product?._id)}>Details</button>
            {tokenPresent ? <button className="primary" onClick={() => onBookmark?.(product?._id)}>Save</button> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

// ── Creatives ────────────────────────────────────────────────────────────────

function CreativesPage({ creatives, pagination, loading, error, backendUrl, onSearch, onOpenCreative }) {
  const [filters, setFilters] = useState({
    q: "", page: "1", limit: "20",
    section: "", isAd: "", minViews: "", hashtags: "", region: "",
    sortBy: "recent", categoryL1: "",
  });
  const clean = (obj) => {
    const out = {};
    Object.entries(obj).forEach(([k, v]) => { if (v !== "" && v != null) out[k] = v; });
    return out;
  };
  const pageNum = Number(filters.page || "1");
  const maxPages = pageCount(pagination);

  function setAndSearch(patch) {
    const next = { ...filters, ...patch };
    setFilters(next);
    onSearch(clean(next));
  }
  function setFilter(patch) { setFilters({ ...filters, ...patch }); }
  function submit() { setAndSearch({ page: "1" }); }
  function goto(n) { setAndSearch({ page: String(Math.min(Math.max(1, n), maxPages)) }); }

  return (
    <div className="page-shell">
      <SectionHeader title="Creative library" subtitle="TikTok ads & organic videos tied to tracked products. Every card links back to the real post." />

      <div className="filter-panel">
        <div className="filter-row wide">
          <input placeholder="Search by product name, creator handle, hashtag..." value={filters.q} onChange={(e) => setFilter({ q: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          <button className="primary" onClick={submit}>Search</button>
        </div>
        <div className="filter-row">
          <select value={filters.section} onChange={(e) => setAndSearch({ section: e.target.value, page: "1" })}>
            <option value="">All sections</option>
            {CREATIVE_SECTIONS.map((s) => <option key={s} value={s}>{SECTION_LABEL[s] || s}</option>)}
          </select>
          <select value={filters.isAd} onChange={(e) => setAndSearch({ isAd: e.target.value, page: "1" })}>
            <option value="">Ads & organic</option>
            <option value="true">Ads only</option>
            <option value="false">Organic only</option>
          </select>
          <select value={filters.sortBy} onChange={(e) => setAndSearch({ sortBy: e.target.value, page: "1" })}>
            <option value="recent">Sort: Recent</option>
            <option value="views">Sort: Views</option>
            <option value="likes">Sort: Likes</option>
            <option value="engagement">Sort: Engagement</option>
          </select>
          <input placeholder="Min views" value={filters.minViews} onChange={(e) => setFilter({ minViews: e.target.value })} />
          <input placeholder="Hashtag" value={filters.hashtags} onChange={(e) => setFilter({ hashtags: e.target.value.replace(/^#/, "") })} />
          <input placeholder="Region (US, GB...)" value={filters.region} onChange={(e) => setFilter({ region: e.target.value.toUpperCase() })} />
          <input placeholder="Category L1" value={filters.categoryL1} onChange={(e) => setFilter({ categoryL1: e.target.value })} />
        </div>
      </div>

      <Pager pagination={pagination} pageNum={pageNum} maxPages={maxPages} onGoto={goto} />
      <ErrorBanner message={error} onRetry={() => onSearch(clean(filters))} />

      <div className="grid creatives-grid" aria-busy={loading}>
        {loading && toArray(creatives).length === 0 ? (
          <GridSkeleton count={8} />
        ) : toArray(creatives).length === 0 && !error ? (
          <EmptyState text="No creatives match these filters." />
        ) : (
          toArray(creatives).map((c, i) => (
            <CreativeCard key={c?._id || i} creative={c} onOpen={onOpenCreative} backendUrl={backendUrl} />
          ))
        )}
      </div>

      <Pager pagination={pagination} pageNum={pageNum} maxPages={maxPages} onGoto={goto} />
    </div>
  );
}

function ShopifySearchPage({ loading, error, results, count, onSearch }) {
  const [productName, setProductName] = useState("");

  function submit() {
    const value = productName.trim();
    if (!value) return;
    onSearch(value);
  }

  return (
    <div className="page-shell">
      <SectionHeader
        title="Shopify search"
        subtitle="Search products through Apify Shopify scraper and inspect high-intent store/share links."
      />
      <div className="filter-panel">
        <div className="filter-row wide">
          <input
            placeholder="Enter product name (e.g. wireless earbuds)"
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          <button className="primary" onClick={submit} disabled={loading}>Search Shopify</button>
        </div>
      </div>

      <div className="shopify-meta">
        <span className="dim small">{loading ? "Searching Shopify..." : `${count} results`}</span>
      </div>
      <ErrorBanner message={error} />

      <div className="grid shopify-grid" aria-busy={loading}>
        {loading ? (
          <GridSkeleton count={8} />
        ) : toArray(results).length === 0 && !error ? (
          <EmptyState text="No Shopify results yet. Search by product name to begin." />
        ) : (
          toArray(results).map((item, i) => <ShopifyResultCard key={item?.id || i} item={item} />)
        )}
      </div>
    </div>
  );
}

function ShopifyResultCard({ item }) {
  const image = (toArray(item?.images).find(Boolean)) || item?.variants?.[0]?.imageUrl || "";
  const price = formatPrice(item?.price, item?.currency);
  return (
    <article className="card shopify-card">
      <div className="media-wrap">
        <MediaImage srcs={[image]} alt={item?.title || "Shopify product"} placeholder="No image" />
      </div>
      <div className="card-body">
        <h3 className="clamp-2">{item?.title || "Untitled product"}</h3>
        <div className="meta-row">
          {item?.vendor ? <span className="pill">{item.vendor}</span> : null}
          {item?.productType ? <span className="pill soft">{item.productType}</span> : null}
          {price ? <span className="price-tag">{price}</span> : null}
        </div>
        <p className="desc clamp-2">{item?.shopName || "Unknown shop"}</p>
        <div className="actions">
          {item?.shareUrl ? <a className="link-btn share-link" href={item.shareUrl} target="_blank" rel="noopener noreferrer">Open shareUrl ↗</a> : null}
          {item?.url ? <a className="link-btn" href={item.url} target="_blank" rel="noopener noreferrer">Product page ↗</a> : null}
        </div>
      </div>
    </article>
  );
}

function BrightDataProductsPage({ products, meta, loading, error, onRefresh, onOpenProduct }) {
  return (
    <div className="page-shell">
      <SectionHeader
        title="Bright data products"
        subtitle="Loaded from the database and rendered as product cards."
        action={<button onClick={onRefresh} disabled={loading}>Refresh</button>}
      />
      <div className="shopify-meta">
        <span className="dim small">
          {loading
            ? "Loading products from DB..."
            : `${meta?.totalProducts ?? 0} products${meta?.totalRecords ? ` · ${meta.totalRecords} total records` : ""}${meta?.exportedAt ? ` · exported ${new Date(meta.exportedAt).toLocaleString()}` : ""}`}
        </span>
      </div>
      <ErrorBanner message={error} onRetry={onRefresh} />
      <div className="grid shopify-grid" aria-busy={loading}>
        {loading ? (
          <GridSkeleton count={8} />
        ) : toArray(products).length === 0 && !error ? (
          <EmptyState text="No products found in the database." />
        ) : (
          toArray(products).map((item, i) => (
            <BrightDataProductCard
              key={item?.id || item?.product_id || item?.external_id || i}
              item={item}
              onOpen={onOpenProduct}
            />
          ))
        )}
      </div>
    </div>
  );
}

function BrightDataProductCard({ item, onOpen }) {
  const image = brightDataCardImage(item);
  const title = brightDataTitle(item);
  const price = brightDataCardPrice(item);
  const pageLink = brightDataProductPageLink(item);
  const streamLink = brightDataDirectVideoLink(item);
  const primaryLink = brightDataPrimaryLink(item);
  const primaryLabel = brightDataPrimaryLinkLabel(item);
  const idParts = [];
  if (item?.id != null) idParts.push(`ID ${item.id}`);
  if (item?.external_id != null && String(item.external_id) !== String(item.id)) {
    idParts.push(`External ${item.external_id}`);
  }
  const idLine = idParts.join(" · ");
  const observedAt = item?.observed_at ? new Date(item.observed_at).toLocaleDateString() : "";

  return (
    <article className="card shopify-card">
      <button className="media-wrap" onClick={() => onOpen?.(item)} aria-label="Open Bright Data product details">
        <MediaImage srcs={[image]} alt={title} placeholder="No image" />
      </button>
      <div className="card-body">
        <h3 className="clamp-2">{title}</h3>
        <div className="meta-row">
          {brightDataIsPresent(item?.category) ? <span className="pill">{String(item.category)}</span> : null}
          {brightDataIsPresent(item?.brand) ? <span className="pill">{item.brand}</span> : null}
          {brightDataIsPresent(item?.source) ? <span className="pill soft">{item.source}</span> : null}
          {brightDataIsPresent(item?.freshness_status) ? <span className="pill soft">{item.freshness_status}</span> : null}
          {item?.In_stock === true ? <span className="pill soft">In stock</span> : null}
          {item?.available === true ? <span className="pill soft">Available</span> : null}
          {price ? <span className="price-tag">{price}</span> : null}
        </div>
        {(idLine || observedAt) ? (
          <p className="dim small clamp-2">
            {idLine}
            {observedAt ? `${idLine ? " · " : ""}observed ${observedAt}` : ""}
          </p>
        ) : null}
        {brightDataIsPresent(item?.description) ? <p className="desc clamp-2">{item.description}</p> : null}
        <div className="actions">
          <button onClick={() => onOpen?.(item)}>Details</button>
          {primaryLink ? (
            <a className="link-btn share-link" href={primaryLink} target="_blank" rel="noopener noreferrer">
              {primaryLabel}
            </a>
          ) : null}
          {pageLink && pageLink !== primaryLink ? (
            <a className="link-btn" href={pageLink} target="_blank" rel="noopener noreferrer">Product ↗</a>
          ) : null}
          {streamLink && streamLink !== primaryLink ? (
            <a className="link-btn" href={streamLink} target="_blank" rel="noopener noreferrer">Video stream ↗</a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

// ── TikTok Live — main page ────────────────────────────────────────────────────

function TikTokLivePage({ loading, lives, error, onDiscover }) {
  const liveList = toArray(lives);
  return (
    <div className="page-shell">
      <SectionHeader
        title="TikTok Live"
        subtitle="Shops from your watchlist that are live right now. Click any card to watch on TikTok."
      />
      <div className="filter-panel" style={{ paddingTop: "0.75rem" }}>
        <div className="filter-row">
          <button className="primary" onClick={onDiscover} disabled={loading}>
            {loading ? "Checking…" : "Refresh"}
          </button>
          {liveList.length > 0 && !loading && (
            <span className="dim small">{liveList.length} store{liveList.length !== 1 ? "s" : ""} live now</span>
          )}
        </div>
      </div>
      <ErrorBanner message={error} />
      <div className="grid shopify-grid" aria-busy={loading}>
        {loading ? <GridSkeleton count={6} /> :
         liveList.length === 0 && !error ? (
          <EmptyState text="No stores are live right now. Check back later or hit Refresh." />
         ) : liveList.map((live, idx) => (
          <SCLiveCard key={live?.handle || idx} live={live} />
         ))}
      </div>
    </div>
  );
}

// ── SCLiveCard (live now card) ─────────────────────────────────────────────────

function SCLiveCard({ live }) {
  const user    = live?.user || {};
  const room    = live?.room || {};
  const streams = live?.streams || {};
  const handle  = live?.handle || user?.uniqueId || "";
  const watchUrl = live?.watchUrl || `https://www.tiktok.com/@${handle}/live`;
  const cover   = room?.coverUrl || room?.squareCoverImg || user?.avatarMedium || user?.avatarThumb;
  const title   = room?.title || `@${handle} is live`;
  const viewers   = room?.liveRoomStats?.userCount;
  const entered   = room?.liveRoomStats?.enterCount;
  const followers = user?.followerCount;
  const streamUrl = streams?.hls || streams?.flv;

  return (
    <article className="card shopify-card sc-live-card">
      <a href={watchUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit", display: "contents" }}>
        <div className="media-wrap">
          {streamUrl ? (
            <video src={streamUrl} poster={cover || undefined}
              muted playsInline preload="metadata"
              style={{ width: "100%", height: "100%", objectFit: "cover", background: "#000" }} />
          ) : (
            <MediaImage srcs={[cover]} alt={title} placeholder="No cover" />
          )}
          <span className="sc-live-badge">🔴 LIVE</span>
        </div>
      </a>
      <div className="card-body">
        <div className="meta-row" style={{ marginBottom: "0.3rem" }}>
          {user?.avatarThumb
            ? <img src={user.avatarThumb} alt={handle} style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
            : null}
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{user?.nickname || `@${handle}`}</div>
            <div className="dim small">@{handle}{user?.verified ? " ✓" : ""}</div>
          </div>
        </div>
        <p className="clamp-2" style={{ fontSize: "0.85rem", margin: "0.25rem 0 0.4rem" }}>{title}</p>
        <div className="meta-row" style={{ flexWrap: "wrap", gap: "0.25rem" }}>
          {viewers  != null ? <span className="pill soft">👁 {compactNumber(viewers)} viewers</span>  : null}
          {entered  != null ? <span className="pill soft">👥 {compactNumber(entered)} joined</span>   : null}
          {followers != null ? <span className="pill soft">{compactNumber(followers)} followers</span> : null}
        </div>
        <div className="actions" style={{ marginTop: "0.6rem" }}>
          <a className="primary"
            style={{ padding: "0.4rem 0.9rem", fontSize: "0.82rem", borderRadius: "var(--radius-sm)", background: "var(--primary)", color: "#fff", textDecoration: "none", fontWeight: 600 }}
            href={watchUrl} target="_blank" rel="noopener noreferrer">
            Watch live ↗
          </a>
        </div>
      </div>
    </article>
  );
}

function CreatorsPage({ loading, creatives, error, onRefresh, backendUrl }) {
  return (
    <div className="page-shell">
      <SectionHeader
        title="Creators"
        subtitle="Live creator streams and videos from your DB creatives collection."
        action={<button onClick={onRefresh} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>}
      />
      <ErrorBanner message={error} onRetry={onRefresh} />
      <div className="grid creatives-grid" aria-busy={loading}>
        {loading ? (
          <GridSkeleton count={8} />
        ) : toArray(creatives).length === 0 && !error ? (
          <EmptyState text="No creators found in DB yet." />
        ) : (
          toArray(creatives).map((creative, i) => {
            const creator = creative?.creator || {};
            const videoSrc = absUrl(backendUrl, creative?.videoProxyUrl) || creative?.videoPlayUrl || "";
            const embedSrc = creative?.embedUrl || (creative?.externalVideoId ? `https://www.tiktok.com/embed/v2/${creative.externalVideoId}` : "");
            return (
              <article className="card creative-card" key={creative?._id || creative?.externalVideoId || i}>
                <div className="media-wrap" style={{ aspectRatio: "9/16", background: "#000" }}>
                  {embedSrc ? (
                    <iframe
                      src={embedSrc}
                      title={creative?.productName || creator?.displayName || "Creator stream"}
                      allow="autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      style={{ width: "100%", height: "100%", border: 0 }}
                    />
                  ) : videoSrc ? (
                    <video
                      src={videoSrc}
                      controls
                      muted
                      playsInline
                      preload="metadata"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <MediaImage srcs={[creative?.thumbnailProxyUrl, creative?.thumbnailUrl]} alt={creative?.productName || "Creator"} placeholder="No media" />
                  )}
                </div>
                <div className="card-body">
                  <h3 className="clamp-2">{creative?.productName || creative?.title || "Creator stream"}</h3>
                  <div className="meta-row">
                    {creator?.handle ? <span className="pill">@{creator.handle}</span> : null}
                    {creator?.displayName ? <span className="pill soft">{creator.displayName}</span> : null}
                    {creator?.followers != null ? <span className="pill soft">{compactNumber(creator.followers)} followers</span> : null}
                    {creator?.region ? <span className="pill soft">{creator.region}</span> : null}
                  </div>
                  <div className="metrics-grid">
                    <Metric label="Views" value={compactNumber(creative?.metrics?.viewCount)} />
                    <Metric label="Likes" value={compactNumber(creative?.metrics?.likeCount)} />
                    <Metric label="Comments" value={compactNumber(creative?.metrics?.commentCount)} />
                    <Metric label="Shares" value={compactNumber(creative?.metrics?.shareCount)} />
                  </div>
                  <div className="actions">
                    {creator?.tiktokPostUrl ? <a className="link-btn share-link" href={creator.tiktokPostUrl} target="_blank" rel="noopener noreferrer">Open TikTok post ↗</a> : null}
                    {embedSrc ? <a className="link-btn" href={embedSrc} target="_blank" rel="noopener noreferrer">Open embed ↗</a> : null}
                    {!embedSrc && videoSrc ? <a className="link-btn" href={videoSrc} target="_blank" rel="noopener noreferrer">Open stream URL ↗</a> : null}
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}

function CreativeCard({ creative, onOpen, backendUrl }) {
  const img = creativeImage(creative);
  const metrics = creative?.metrics || {};
  const creator = creative?.creator || {};
  const engagement = metrics?.engagementRate != null ? `${Number(metrics.engagementRate).toFixed(2)}%` : null;
  const tags = toArray(creative?.hashtags).slice(0, 5);
  const title = creative?.productName || creative?.title || creative?.caption || creator?.displayName || "Creative";
  const proxyThumb = absUrl(backendUrl, creative?.thumbnailProxyUrl);
  const proxyAvatar = absUrl(backendUrl, creator?.avatarProxyUrl);
  return (
    <article className="card creative-card">
      <button className="media-wrap" onClick={() => onOpen?.(creative?._id)} aria-label="Open creative">
        <MediaImage srcs={[proxyThumb, img]} alt={title} placeholder="No preview" />
        <div className="media-overlay">
          <span className="pill soft">{SECTION_LABEL[creative?.section] || creative?.section || "—"}</span>
          {creative?.isAd ? <span className="pill hot">Ad</span> : <span className="pill">Organic</span>}
          <SourcePill source={metrics?.source} region={creator?.region} />
        </div>
        {(creative?.videoProxyUrl || creative?.videoPlayUrl || creative?.embedUrl) ? <div className="play-icon">▶</div> : null}
      </button>

      <div className="card-body">
        <h3 className="clamp-2" title={title}>{title}</h3>

        <div className="creator-row">
          <MediaImage
            srcs={[proxyAvatar, creator?.avatarUrl]}
            alt={creator?.handle || ""}
            className="creator-avatar"
            initials={(creator?.handle || "?").slice(0, 1).toUpperCase()}
          />
          <div className="creator-meta">
            <div className="creator-handle">@{creator?.handle || "unknown"}{creator?.verified ? " ✓" : ""}</div>
            <div className="creator-sub">{compactNumber(creator?.followers)} followers · {creator?.region || "—"}</div>
          </div>
          {creator?.tiktokPostUrl ? <a className="link-btn" href={creator.tiktokPostUrl} target="_blank" rel="noopener noreferrer">Watch ↗</a> : null}
        </div>

        {creative?.description || creative?.productDescription ? (
          <p className="desc clamp-3">{creative.productDescription || creative.description}</p>
        ) : null}

        <div className="metrics-grid">
          <Metric label="Views" value={compactNumber(metrics?.viewCount)} />
          <Metric label="Likes" value={compactNumber(metrics?.likeCount)} />
          <Metric label="Comments" value={compactNumber(metrics?.commentCount)} />
          <Metric label="Shares" value={compactNumber(metrics?.shareCount)} />
          <Metric label="Engagement" value={engagement || "-"} />
        </div>

        <div className="meta-row">
          {creative?.categoryL1 ? <span className="pill">{creative.categoryL1}</span> : null}
          {creative?.categoryL2 ? <span className="pill soft">{creative.categoryL2}</span> : null}
        </div>

        {tags.length > 0 && (
          <div className="tag-row">
            {tags.map((h, i) => <span className="tag" key={i}>#{String(h).replace(/^#/, "")}</span>)}
          </div>
        )}

        <div className="card-footer">
          <span className="dim small">{creative?.publishedAt ? new Date(creative.publishedAt).toLocaleDateString() : ""}</span>
          <button onClick={() => onOpen?.(creative?._id)}>Details</button>
        </div>
      </div>
    </article>
  );
}

// ── Pricing ──────────────────────────────────────────────────────────────────

function PricingPage({ plans, planMode, subscription, onCheckout }) {
  const list = toArray(plans);
  return (
    <div className="page-shell">
      <SectionHeader
        title="Pricing"
        subtitle={`Billing mode: ${planMode === "live" ? "LIVE" : "TEST"}. Current plan: ${subscription?.plan || "free"}. Upgrade or start a trial below — Stripe handles everything.`}
      />
      <div className="grid plans-grid">
        {list.map((plan) => {
          const copy = PLAN_COPY[plan.id] || {};
          const priceText = formatMoney(plan?.price?.amountCents, plan?.price?.currency) || "Configure in Stripe";
          const cadence = plan?.price?.interval ? `/${plan.price.interval}` : (plan.checkoutMode === "payment" ? " one-time" : "");
          const isCurrent = subscription?.plan && subscription.plan === plan.id;
          return (
            <article className={`plan-card ${plan.id === "pro" ? "highlight" : ""}`} key={plan.id}>
              <div className="plan-head">
                <h3>{plan.id[0].toUpperCase() + plan.id.slice(1)}</h3>
                {plan.id === "pro" ? <span className="pill accent">Most popular</span> : null}
                {isCurrent ? <span className="pill hot">Current plan</span> : null}
              </div>
              <p className="dim">{copy.tagline || "Plan"}</p>
              <div className="price-block">
                <span className="big-price">{priceText}</span>
                <span className="cadence">{cadence}</span>
              </div>
              <ul className="features">
                <li>{plan?.limits?.creditsPerMonth ?? "-"} credits / month</li>
                {plan?.limits?.keywordContextPerMonth != null ? <li>{plan.limits.keywordContextPerMonth} keyword contexts / month</li> : null}
                {plan?.limits?.maxSavedProducts != null ? <li>{plan.limits.maxSavedProducts} saved products</li> : null}
                {(copy.features || []).map((f, i) => <li key={i}>{f}</li>)}
              </ul>
              <button className="primary block" onClick={() => onCheckout(plan.id)} disabled={isCurrent}>
                {isCurrent ? "You're on this plan" : (plan.checkoutMode === "payment" ? "Start trial" : `Choose ${plan.id}`)}
              </button>
              <p className="dim small">{plan.stripePriceConfigured ? "Stripe price configured" : "⚠︎ Stripe price not configured for this plan"}</p>
            </article>
          );
        })}
        {list.length === 0 && <EmptyState text="Pricing unavailable. Make sure the backend is reachable and /billing/plans returns data." />}
      </div>
    </div>
  );
}

function MiniPlanCard({ plan }) {
  const priceText = formatMoney(plan?.price?.amountCents, plan?.price?.currency) || "—";
  const cadence = plan?.price?.interval ? `/${plan.price.interval}` : "";
  return (
    <article className="plan-card mini">
      <h3>{plan.id[0].toUpperCase() + plan.id.slice(1)}</h3>
      <div className="price-block">
        <span className="big-price">{priceText}</span>
        <span className="cadence">{cadence}</span>
      </div>
      <p className="dim small">{plan?.limits?.creditsPerMonth ?? "-"} credits / month</p>
    </article>
  );
}

// ── Account ──────────────────────────────────────────────────────────────────

function AccountPage({ token, me, subscription, bookmarks, onRegister, onVerify, onSignIn, onSignOut, onLoadBookmarks, onOpenProduct }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("Password1");
  const [code, setCode] = useState("");
  const [name, setName] = useState("Test User");
  const [registerStep, setRegisterStep] = useState("email");

  useEffect(() => {
    if (mode !== "register") setRegisterStep("email");
  }, [mode]);

  async function handleSendVerificationCode() {
    const cleanedEmail = email.trim();
    if (!cleanedEmail) return;
    await onRegister(cleanedEmail);
    setRegisterStep("verify");
  }

  async function handleCompleteRegistration() {
    const cleanedEmail = email.trim();
    const cleanedCode = code.trim();
    const cleanedName = name.trim();
    if (!cleanedEmail || !cleanedCode || !cleanedName || !password) return;
    await onVerify(cleanedEmail, cleanedCode, password, cleanedName);
  }

  if (!token) {
    return (
      <div className="page-shell">
        <SectionHeader title="Welcome back" subtitle="Sign in to save products, manage billing, and sync your workspace." />
        <div className="auth-shell">
          <div className="auth-card">
            <div className="auth-tabs">
              <button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Sign in</button>
              <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Create account</button>
            </div>
            {mode === "signin" ? (
              <>
                <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
                <button className="primary block" onClick={() => onSignIn(email, password)}>Sign in</button>
              </>
            ) : (
              <>
                <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
                {registerStep === "email" ? (
                  <button className="block" onClick={handleSendVerificationCode} disabled={!email.trim()}>
                    Send 6-digit code
                  </button>
                ) : (
                  <>
                    <p className="dim small">We sent a 6-digit code to <strong>{email.trim()}</strong>.</p>
                    <label>Verification code (6 digits)<input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} /></label>
                    <label>Full name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
                    <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
                    <button className="primary block" onClick={handleCompleteRegistration} disabled={!code.trim() || !name.trim() || !password}>
                      Create account
                    </button>
                    <button className="block" onClick={() => setRegisterStep("email")}>Change email</button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <SectionHeader
        title="My account"
        subtitle="Manage your workspace, plan & saved products."
        action={<button onClick={onSignOut}>Sign out</button>}
      />
      <div className="stats">
        <Stat label="Email" value={me?.email || "-"} />
        <Stat label="Name" value={me?.name || "-"} />
        <Stat label="Plan" value={subscription?.plan || "-"} />
        <Stat label="Credits" value={subscription?.creditBalance != null ? compactNumber(subscription.creditBalance) : "-"} />
      </div>

      <SectionHeader title="Saved products" action={<button onClick={onLoadBookmarks}>Refresh saved</button>} />
      <div className="grid products-grid">
        {toArray(bookmarks).map((b, i) => {
          const p = b?.product || b;
          return <ProductCard key={p?._id || i} product={p} onOpen={onOpenProduct} onBookmark={() => {}} tokenPresent={false} />;
        })}
        {toArray(bookmarks).length === 0 && <EmptyState text="Nothing saved yet. Hit Save on any product to keep tabs on it." />}
      </div>
    </div>
  );
}

// ── My Shopify (connect / disconnect / push products) ───────────────────────

function ShopifyPage({
  token,
  connection,
  configured,
  loading,
  error,
  notice,
  onConnect,
  onDisconnect,
  onRefresh,
  onDismissNotice,
  onGoSignIn,
}) {
  const [shop, setShop] = useState("");

  if (!token) {
    return (
      <div className="page-shell">
        <SectionHeader
          title="My Shopify store"
          subtitle="Connect your Shopify store to push winning products straight from ValidDs."
        />
        <div className="callout">
          You need to be signed in to connect a Shopify store.{" "}
          <button className="link-btn" onClick={onGoSignIn}>Sign in →</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <SectionHeader
        title="My Shopify store"
        subtitle="Connect a Shopify store, then push any ValidDs product to it as a draft with one click."
        action={<button onClick={onRefresh} disabled={loading}>Refresh</button>}
      />

      {notice ? (
        <div
          className={`callout`}
          style={{
            background: notice.kind === "error" ? "#fbe7eb" : notice.kind === "info" ? "#eef1f9" : "#e8f7ef",
            color: notice.kind === "error" ? "#a01840" : "#1c2c50",
            border: `1px solid ${notice.kind === "error" ? "#f4b6c4" : notice.kind === "info" ? "#dbe3f4" : "#a0dec8"}`,
          }}
        >
          <span>{notice.message}</span>{" "}
          <button className="link-btn" onClick={onDismissNotice} style={{ marginLeft: 8 }}>Dismiss</button>
        </div>
      ) : null}

      {error ? <div className="callout" style={{ background: "#fbe7eb", color: "#a01840", border: "1px solid #f4b6c4" }}>{error}</div> : null}

      {!configured ? (
        <div className="callout">
          The backend is missing Shopify OAuth credentials. Set <code>SHOPIFY_API_KEY</code>,{" "}
          <code>SHOPIFY_API_SECRET</code>, and <code>SHOPIFY_REDIRECT_URI</code> in your backend
          <code>.env</code>, then restart and refresh.
        </div>
      ) : null}

      {connection ? (
        <ConnectedShopifyCard
          connection={connection}
          onDisconnect={onDisconnect}
          disabled={loading}
        />
      ) : (
        <ConnectShopifyCard
          shop={shop}
          setShop={setShop}
          onConnect={onConnect}
          disabled={loading || !configured}
          signupDisabled={loading}
        />
      )}

      <Block title="How it works">
        <ol className="list" style={{ paddingLeft: "1.2rem" }}>
          <li>
            <strong>Have a Shopify store?</strong> Enter your <code>&lt;name&gt;.myshopify.com</code> domain and click
            <em> Connect store</em>. You'll be redirected to Shopify to authorise ValidDs.
          </li>
          <li>
            <strong>No store yet?</strong> Click <em>I don't have a store yet</em> — we'll send you to Shopify's
            signup flow. Come back here after creating your store.
          </li>
          <li>
            Once connected, open any product detail and click <em>Push to Shopify</em> to create a draft
            product on your store (with images, price, tags & variants pre-filled from ValidDs).
          </li>
        </ol>
      </Block>
    </div>
  );
}

function ConnectShopifyCard({ shop, setShop, onConnect, disabled, signupDisabled }) {
  return (
    <div className="auth-card" style={{ maxWidth: "100%" }}>
      <h2 style={{ marginBottom: 4 }}>Connect a Shopify store</h2>
      <p className="dim small" style={{ marginBottom: "1rem" }}>
        Enter your shop domain (e.g. <code>my-store.myshopify.com</code> or just <code>my-store</code>).
      </p>
      <label>
        Shop domain
        <input
          value={shop}
          onChange={(e) => setShop(e.target.value)}
          placeholder="my-store.myshopify.com"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div className="actions" style={{ marginTop: "0.5rem" }}>
        <button
          className="primary"
          onClick={() => onConnect(shop)}
          disabled={disabled || !shop.trim()}
        >
          {disabled ? "Working…" : "Connect store"}
        </button>
        <button onClick={() => onConnect("")} disabled={signupDisabled ?? disabled}>
          I don't have a store yet
        </button>
      </div>
      <p className="dim small" style={{ marginTop: "0.6rem" }}>
        Required scopes: <code>write_products,read_products</code>. We never see your customers, orders, or payouts.
      </p>
    </div>
  );
}

function ConnectedShopifyCard({ connection, onDisconnect, disabled }) {
  const installed = connection.installedAt ? new Date(connection.installedAt).toLocaleString() : "-";
  const lastSync = connection.lastSyncedAt ? new Date(connection.lastSyncedAt).toLocaleString() : "-";
  return (
    <div className="auth-card" style={{ maxWidth: "100%" }}>
      <div className="card-title-row" style={{ marginBottom: "0.6rem" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>
            {connection.shopName || connection.shop}
          </h2>
          <p className="dim small">
            <span className="pill good">Connected</span>{" "}
            <code>{connection.shop}</code>
          </p>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: "1rem" }}>
        <Stat label="Owner" value={connection.shopOwner || "-"} />
        <Stat label="Country" value={connection.shopCountry || "-"} />
        <Stat label="Currency" value={connection.shopCurrency || "-"} />
        <Stat label="Connected at" value={installed} />
        <Stat label="Last sync" value={lastSync} />
        <Stat label="Scope" value={connection.scope || "-"} />
      </div>

      <div className="actions">
        {connection.adminUrl ? (
          <a className="link-btn" href={connection.adminUrl} target="_blank" rel="noopener noreferrer">
            Open Shopify admin ↗
          </a>
        ) : null}
        <button onClick={onDisconnect} disabled={disabled}>
          {disabled ? "Working…" : "Disconnect"}
        </button>
      </div>

      <p className="dim small" style={{ marginTop: "0.8rem" }}>
        Disconnecting only removes the access token from ValidDs. To fully revoke access,
        also uninstall the app from your Shopify admin → Settings → Apps.
      </p>
    </div>
  );
}

// Reusable "Push to Shopify" button — shows status overrides on click.
function PushToShopifyButton({
  productId,
  tokenPresent,
  shopifyConnected,
  shopifyPushing,
  onPushToShopify,
  onGoShopify,
}) {
  const [expanded, setExpanded] = useState(false);
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState("draft");
  const [lastResult, setLastResult] = useState(null);

  if (!tokenPresent) return null;
  if (!productId) return null;

  async function handlePush() {
    const result = await onPushToShopify(productId, {
      price: price ? Number(price) : undefined,
      status,
    });
    if (result) {
      setLastResult(result);
      setExpanded(false);
    }
  }

  if (!shopifyConnected) {
    return (
      <button onClick={onGoShopify} title="Connect your Shopify store first">
        Connect Shopify to push →
      </button>
    );
  }

  if (lastResult) {
    return (
      <div className="actions">
        <a className="link-btn" href={lastResult.adminUrl} target="_blank" rel="noopener noreferrer">
          View on Shopify ↗
        </a>
        <button onClick={() => setLastResult(null)}>Push another</button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button className="primary" onClick={() => setExpanded(true)} disabled={shopifyPushing}>
        {shopifyPushing ? "Pushing…" : "Push to Shopify"}
      </button>
    );
  }

  return (
    <div
      className="auth-card"
      style={{ maxWidth: "100%", padding: "0.8rem", border: "1px solid var(--line)" }}
    >
      <p className="dim small" style={{ marginBottom: "0.5rem" }}>
        Push this product to your connected Shopify store as a new product.
      </p>
      <label>
        Price override (optional)
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Leave blank to use ValidDs price"
        />
      </label>
      <label>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="draft">Draft (recommended)</option>
          <option value="active">Active (visible to buyers)</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <div className="actions" style={{ marginTop: "0.5rem" }}>
        <button className="primary" onClick={handlePush} disabled={shopifyPushing}>
          {shopifyPushing ? "Pushing…" : "Push now"}
        </button>
        <button onClick={() => setExpanded(false)} disabled={shopifyPushing}>Cancel</button>
      </div>
    </div>
  );
}

// ── Modals ───────────────────────────────────────────────────────────────────

function ModalShell({ onClose, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div />
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body modal-body-center">{children}</div>
      </div>
    </div>
  );
}

function ModalLoading({ label = "Loading..." }) {
  return (
    <div className="modal-loading">
      <div className="spinner big" />
      <p className="dim">{label}</p>
    </div>
  );
}

function ModalError({ message }) {
  return (
    <div className="modal-loading">
      <div className="error-icon">!</div>
      <p><strong>Couldn't load that item.</strong></p>
      <p className="dim small">{message || "Unknown error"}</p>
    </div>
  );
}

function ProductModal({
  product,
  onClose,
  onBookmark,
  tokenPresent,
  backendUrl,
  loading,
  shopifyConnected,
  shopifyPushing,
  onPushToShopify,
  onGoShopify,
}) {
  if (product?.__loading || loading) {
    return <ModalShell onClose={onClose}><ModalLoading label="Loading product..." /></ModalShell>;
  }
  if (product?.__error) {
    return <ModalShell onClose={onClose}><ModalError message={product.__error} /></ModalShell>;
  }
  const img = productImage(product);
  const imgs = toArray(product?.imageUrls).filter(Boolean);
  const trend = product?.trend || {};
  const ai = product?.aiInsight || {};
  const comments = toArray(product?.topComments);
  const reviews = toArray(product?.reviews);
  const suppliers = toArray(product?.suppliers);
  const ratingSources = toArray(product?.ratingSources);
  const related = toArray(product?.relatedProducts);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="clamp-2">{product?.title}</h2>
            <p className="dim small">{product?.categoryPath} · <SourcePill source={product?.source} region={product?.region} inline /></p>
          </div>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-media">
            <MediaImage srcs={[img]} alt={product?.title || ""} placeholder="No image" eager />
            {imgs.length > 1 && (
              <div className="thumb-row">
                {imgs.slice(0, 8).map((u, i) => <MediaImage key={i} srcs={[u]} alt="" placeholder="" />)}
              </div>
            )}
          </div>
          <div className="modal-info">
            <p>{product?.description || "—"}</p>

            <div className="metrics-grid wide">
              <Metric label="Trend score" value={`${trend?.score ?? "-"} / 100`} hint={trend?.direction} />
              <Metric label="Views" value={compactNumber(product?.viewCount)} />
              <Metric label="Likes" value={compactNumber(product?.likeCount)} />
              <Metric label="Comments" value={compactNumber(product?.commentCount)} />
              <Metric label="Shares" value={compactNumber(product?.shareCount)} />
              <Metric label="Engagement" value={product?.engagementRate != null ? `${Number(product.engagementRate).toFixed(2)}%` : "-"} />
              {product?.price != null ? <Metric label="Price" value={formatPrice(product.price, product.currency)} /> : null}
              {product?.totalSale30d != null ? <Metric label="Sales 30d" value={compactNumber(product.totalSale30d)} /> : null}
              {product?.totalSale7d != null ? <Metric label="Sales 7d" value={compactNumber(product.totalSale7d)} /> : null}
              {product?.totalGmv != null ? <Metric label="GMV" value={compactNumber(product.totalGmv)} /> : null}
              {product?.totalCreators != null ? <Metric label="Creators" value={compactNumber(product.totalCreators)} /> : null}
              {product?.commissionRate != null ? <Metric label="Commission" value={`${(Number(product.commissionRate) * 100).toFixed(1)}%`} /> : null}
            </div>

            {(ai?.confidence?.score != null || ai?.buyingSentiment?.score != null) && (
              <>
                {ai?.confidence?.score != null && <div><Bar label="AI confidence" value={Number(ai.confidence.score)} /><p className="dim small">{ai.confidence.reason}</p></div>}
                {ai?.buyingSentiment?.score != null && <div><Bar label="Buying intent" value={Number(ai.buyingSentiment.score)} /><p className="dim small">{ai.buyingSentiment.reason}</p></div>}
              </>
            )}

            {trend?.reason ? <p className="callout">📊 {trend.reason}</p> : null}

            {suppliers.length > 0 && (
              <Block title="Suppliers">
                <ul className="list">
                  {suppliers.map((s, i) => (
                    <li key={i}>
                      <strong>{s.platform}</strong> — {formatPrice(s.price, s.currency) || "price ?"} · ships {s.shippingDays ?? "?"}d · MOQ {s.moq ?? "?"}
                      {s.productUrl ? <> · <a href={s.productUrl} target="_blank" rel="noopener noreferrer">open listing ↗</a></> : null}
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {ratingSources.length > 0 && (
              <Block title="Rating sources">
                <ul className="list">
                  {ratingSources.map((r, i) => (
                    <li key={i}>
                      <strong>{r.platform}</strong> ★ {Number(r.rating).toFixed(1)} ({compactNumber(r.reviewCount)} reviews)
                      {r.sourceUrl ? <> · <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">view ↗</a></> : null}
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {comments.length > 0 && (
              <Block title="Top TikTok comments">
                <ul className="list">
                  {comments.slice(0, 6).map((c, i) => (
                    <li key={i}>
                      <span className={`pill ${c.sentiment === "positive" ? "accent" : c.sentiment === "negative" ? "hot" : ""}`}>{c.sentiment || "neutral"}</span>
                      {" "}{c.authorHandle ? <strong>@{c.authorHandle}</strong> : null} {c.comment || c.text}
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {reviews.length > 0 && (
              <Block title="Review snippets">
                <ul className="list">
                  {reviews.slice(0, 6).map((r, i) => <li key={i}><strong>{r.source}</strong>: {r.text}</li>)}
                </ul>
              </Block>
            )}

            {related.length > 0 && (
              <Block title="Related products">
                <div className="mini-grid">
                  {related.slice(0, 6).map((r, i) => (
                    <a className="mini-card" key={i} href={r.link} target="_blank" rel="noopener noreferrer">
                      {r.thumbnail ? <img src={r.thumbnail} alt={r.title} /> : <div className="media-placeholder">No image</div>}
                      <div className="mini-title clamp-2">{r.title}</div>
                      <div className="dim small">{r.store} · {r.price}</div>
                    </a>
                  ))}
                </div>
              </Block>
            )}

            <Block title="Creator (discovery post)">
              <CreatorInline creator={product?.primaryCreator} backendUrl={backendUrl} />
            </Block>

            <div className="actions">
              {product?.primaryCreator?.tiktokPostUrl ? <a className="link-btn" href={product.primaryCreator.tiktokPostUrl} target="_blank" rel="noopener noreferrer">Open TikTok post ↗</a> : null}
              {tokenPresent ? <button className="primary" onClick={() => onBookmark?.(product?._id)}>Save to library</button> : null}
              {tokenPresent && product?._id ? (
                <PushToShopifyButton
                  productId={product._id}
                  tokenPresent={tokenPresent}
                  shopifyConnected={shopifyConnected}
                  shopifyPushing={shopifyPushing}
                  onPushToShopify={onPushToShopify}
                  onGoShopify={onGoShopify}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreativeModal({ creative, onClose, backendUrl, loading }) {
  if (creative?.__loading || loading) {
    return <ModalShell onClose={onClose}><ModalLoading label="Loading creative..." /></ModalShell>;
  }
  if (creative?.__error) {
    return <ModalShell onClose={onClose}><ModalError message={creative.__error} /></ModalShell>;
  }
  const img = creativeImage(creative);
  const proxyThumb = absUrl(backendUrl, creative?.thumbnailProxyUrl);
  const proxySrc = absUrl(backendUrl, creative?.videoProxyUrl);
  const embedSrc = creative?.embedUrl || (creative?.externalVideoId ? `https://www.tiktok.com/embed/v2/${creative.externalVideoId}` : null);
  const proxyAvatar = absUrl(backendUrl, creative?.creator?.avatarProxyUrl);
  const [useEmbed, setUseEmbed] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoError, setVideoError] = useState("");
  useEffect(() => { setUseEmbed(false); setVideoReady(false); setVideoError(""); }, [creative?._id]);
  const metrics = creative?.metrics || {};
  const creator = creative?.creator || {};
  const comments = toArray(creative?.topComments);
  const related = toArray(creative?.relatedVideos);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="clamp-2">{creative?.productName || creator?.displayName || "Creative"}</h2>
            <p className="dim small">
              {SECTION_LABEL[creative?.section] || creative?.section} · {creative?.isAd ? "Paid ad" : "Organic"}
              {creative?.publishedAt ? ` · ${new Date(creative.publishedAt).toLocaleDateString()}` : ""}
            </p>
          </div>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-media">
            <div className="video-wrap">
              {useEmbed && embedSrc ? (
                <iframe
                  src={embedSrc}
                  title="TikTok video"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="video-frame"
                />
              ) : proxySrc ? (
                <>
                  <video
                    key={creative?._id}
                    className="video-el"
                    src={proxySrc}
                    poster={proxyThumb || img || undefined}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedData={() => setVideoReady(true)}
                    onCanPlay={() => setVideoReady(true)}
                    onError={() => {
                      if (embedSrc) setUseEmbed(true);
                      else setVideoError("This video can't be played right now.");
                    }}
                  />
                  {!videoReady && !videoError && (
                    <div className="video-loading" aria-live="polite">
                      <div className="spinner" /> <span>Loading video…</span>
                    </div>
                  )}
                  {videoError && (
                    <div className="video-error">{videoError}</div>
                  )}
                </>
              ) : embedSrc ? (
                <iframe
                  src={embedSrc}
                  title="TikTok video"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="video-frame"
                />
              ) : (
                <MediaImage srcs={[proxyThumb, img]} alt="" placeholder="No media" eager />
              )}
            </div>
          </div>
          <div className="modal-info">
            <CreatorInline creator={creator} backendUrl={backendUrl} />
            {creative?.productDescription || creative?.description ? <p>{creative.productDescription || creative.description}</p> : null}

            <div className="metrics-grid wide">
              <Metric label="Views" value={compactNumber(metrics?.viewCount)} />
              <Metric label="Likes" value={compactNumber(metrics?.likeCount)} />
              <Metric label="Comments" value={compactNumber(metrics?.commentCount)} />
              <Metric label="Shares" value={compactNumber(metrics?.shareCount)} />
              <Metric label="Engagement" value={metrics?.engagementRate != null ? `${Number(metrics.engagementRate).toFixed(2)}%` : "-"} />
              <Metric label="Metric source" value={metrics?.source || "-"} />
            </div>

            {toArray(creative?.hashtags).length > 0 && (
              <div className="tag-row">
                {toArray(creative.hashtags).map((h, i) => <span className="tag" key={i}>#{String(h).replace(/^#/, "")}</span>)}
              </div>
            )}

            {comments.length > 0 && (
              <Block title="Top comments">
                <ul className="list">
                  {comments.slice(0, 6).map((c, i) => (
                    <li key={i}>{c.authorHandle ? <strong>@{c.authorHandle}</strong> : null} {c.comment} <span className="dim small">({compactNumber(c.likeCount)} likes)</span></li>
                  ))}
                </ul>
              </Block>
            )}

            {related.length > 0 && (
              <Block title="Related videos">
                <div className="mini-grid">
                  {related.slice(0, 6).map((v, i) => {
                    const thumb = absUrl(backendUrl, v.thumbnailProxyUrl);
                    return (
                      <div className="mini-card" key={i}>
                        <MediaImage srcs={[thumb, v.thumbnailUrl]} alt="" placeholder="No preview" />
                        <div className="mini-title">@{v.creator?.handle || "unknown"}</div>
                        <div className="dim small">{compactNumber(v.metrics?.viewCount)} views</div>
                      </div>
                    );
                  })}
                </div>
              </Block>
            )}

            <div className="actions">
              {creator?.tiktokPostUrl ? <a className="link-btn" href={creator.tiktokPostUrl} target="_blank" rel="noopener noreferrer">Open TikTok post ↗</a> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Compact push-to-Shopify widget for the modal aside
function BrightAsidePushButton({ productId, shopifyPushing, onPushToShopify }) {
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState("draft");
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState(null);

  async function handlePush() {
    const res = await onPushToShopify(productId, {
      price: price ? Number(price) : undefined,
      status,
    });
    if (res) { setResult(res); setExpanded(false); }
  }

  if (result) {
    return (
      <div style={{ marginTop: "0.4rem" }}>
        <a
          className="bright-shopify-connect-btn"
          href={result.adminUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ textDecoration: "none" }}
        >
          <span className="bright-shopify-btn-icon">✓</span>
          View on Shopify ↗
        </a>
        <button className="link-btn" style={{ marginTop: "0.4rem", display: "block" }} onClick={() => setResult(null)}>
          Push again
        </button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        className="bright-shopify-connect-btn bright-shopify-push-btn"
        onClick={() => setExpanded(true)}
        disabled={shopifyPushing}
      >
        <span className="bright-shopify-btn-icon">🛍</span>
        {shopifyPushing ? "Pushing…" : "Push to Shopify"}
      </button>
    );
  }

  return (
    <div className="bright-shopify-push-form">
      <label className="bright-shopify-push-label">
        Price <span className="dim">(optional)</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Use product price"
          className="bright-shopify-push-input"
        />
      </label>
      <label className="bright-shopify-push-label">
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bright-shopify-push-input">
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </label>
      <div className="bright-shopify-push-actions">
        <button
          className="bright-shopify-connect-btn bright-shopify-push-btn"
          onClick={handlePush}
          disabled={shopifyPushing}
        >
          {shopifyPushing ? "Pushing…" : "Push now"}
        </button>
        <button className="link-btn" onClick={() => setExpanded(false)} disabled={shopifyPushing}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function BrightModalPanel({ title, variant, children }) {
  return (
    <section className={`bright-panel${variant === "highlight" ? " bright-panel--accent" : ""}`}>
      <h4 className="bright-panel-title">{title}</h4>
      <div className="bright-panel-content">{children}</div>
    </section>
  );
}

function BrightDataProductModal({
  product,
  onClose,
  tokenPresent,
  shopifyConnected,
  shopifyPushing,
  onPushToShopify,
  onGoShopify,
}) {
  const [galleryIdx, setGalleryIdx] = useState(0);

  useEffect(() => {
    function onEsc(e) {
      if (e.key === "Escape") onClose?.();
    }
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const galleryUrls = useMemo(() => {
    if (!product) return [];
    const list = brightDataGalleryImages(product);
    if (list.length) return list.slice(0, 24);
    const h = brightDataCardImage(product);
    return h ? [h] : [];
  }, [product]);

  useEffect(() => {
    setGalleryIdx(0);
  }, [product]);

  if (!product) return null;

  const displayTitle = brightDataTitle(product);
  const priceDisplay = brightDataCardPrice(product);

  const safeGalleryIdx = Math.min(galleryIdx, Math.max(galleryUrls.length - 1, 0));
  const heroSrc = galleryUrls[safeGalleryIdx] || "";
  const thumbs = galleryUrls;
  const mainLink = brightDataPrimaryLink(product);
  const mainLinkCaption = brightDataPrimaryLinkLabel(product).replace(/\s↗$/, "");
  const urlKeys = ["url", "product_url", "video_link", "category_url", "shareUrl", "share_url"];
  const extraLinks = urlKeys
    .map((k) => ({ k, href: product[k] }))
    .filter((x) => brightDataIsPresent(x.href) && String(x.href).trim() !== String(mainLink).trim());

  const allKeys = brightDataSortedKeys(product).filter((k) => k !== "images");
  const SKIP_SCALAR = new Set(["title", "name"]);
  const LONG_AS_BLOCK = new Set(["description", "desc_detail"]);
  const URL_SCALAR_KEYS = new Set([
    "url", "product_url", "video_link", "category_url", "shareUrl", "share_url",
    "post_url", "tiktok_post_url", "video_post_url", "advertising_post_url", "tiktok_video_url",
  ]);

  const scalarEntries = [];
  const blockKeys = [];

  for (const k of allKeys) {
    const v = product[k];
    if (!brightDataIsPresent(v)) continue;

    if (URL_SCALAR_KEYS.has(k)) continue;

    if (LONG_AS_BLOCK.has(k) && typeof v === "string") {
      blockKeys.push(k);
      continue;
    }

    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      if (SKIP_SCALAR.has(k)) continue;
      scalarEntries.push([k, v]);
      continue;
    }

    blockKeys.push(k);
  }

  const subtitleParts = [];
  if (brightDataIsPresent(product.brand)) subtitleParts.push(String(product.brand));
  if (brightDataIsPresent(product.source_entity_type)) subtitleParts.push(String(product.source_entity_type));
  if (brightDataIsPresent(product.category)) subtitleParts.push(String(product.category));
  if (brightDataIsPresent(product.domain)) subtitleParts.push(String(product.domain));
  if (brightDataIsPresent(product.source)) subtitleParts.push(String(product.source));

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal bright-modal bright-modal--product"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bright-modal-product-title"
      >
        <header className="bright-modal-head">
          <div className="bright-modal-head-main">
            <div className="bright-modal-title-row">
              <h2 id="bright-modal-product-title" className="bright-modal-title clamp-2">{displayTitle}</h2>
              {priceDisplay ? <span className="bright-modal-price-chip">{priceDisplay}</span> : null}
            </div>
            {subtitleParts.length > 0 ? (
              <p className="bright-modal-subtitle dim small">{subtitleParts.join(" · ")}</p>
            ) : null}
            <div className="bright-modal-quick-pills meta-row">
              {brightDataIsPresent(product.category) ? <span className="pill">{String(product.category)}</span> : null}
              {brightDataIsPresent(product.currency) ? <span className="pill soft">{String(product.currency)}</span> : null}
              {product?.sold != null && Number(product.sold) > 0 ? <span className="pill soft">{compactNumber(product.sold)} sold</span> : null}
              {product?.available === true ? <span className="pill soft">Available</span> : null}
            </div>
          </div>
          <button type="button" className="bright-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="bright-modal-scroll">
          <div className="bright-modal-split">
            <aside className="bright-modal-aside" aria-label="Product gallery">
              <div className="bright-modal-hero">
                <MediaImage srcs={[heroSrc]} alt={displayTitle} placeholder="No image" eager />
              </div>
              {thumbs.length > 1 ? (
                <div className="bright-modal-thumbs" role="tablist" aria-label="Product images">
                  {thumbs.map((u, i) => (
                    <button
                      key={i}
                      type="button"
                      role="tab"
                      aria-selected={i === safeGalleryIdx}
                      className={`bright-modal-thumb${i === safeGalleryIdx ? " is-active" : ""}`}
                      onClick={() => setGalleryIdx(i)}
                    >
                      <img src={u} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              ) : thumbs.length === 1 ? (
                <p className="dim small bright-modal-gallery-hint">1 image</p>
              ) : null}

              <div className="bright-modal-aside-card">
                <div className="bright-modal-aside-label">Status</div>
                <div className="meta-row">
                  {brightDataIsPresent(product.freshness_status) ? <span className="pill soft">{product.freshness_status}</span> : null}
                  {brightDataIsPresent(product.validation_status) ? <span className="pill soft">{product.validation_status}</span> : null}
                  {product?.In_stock === true ? <span className="pill soft">In stock</span> : null}
                </div>
                {(product?.id != null || product?.external_id != null) ? (
                  <div className="bright-modal-aside-label">Identifiers</div>
                ) : null}
                {(product?.id != null || product?.external_id != null) ? (
                  <div className="bright-id-line">
                    {product?.id != null ? <code className="bright-id-chip">{String(product.id)}</code> : null}
                    {product?.external_id != null && String(product.external_id) !== String(product.id) ? (
                      <code className="bright-id-chip">{String(product.external_id)}</code>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* ── Add to Shopify ── */}
              <div className="bright-modal-aside-card bright-modal-shopify-card">
                <div className="bright-modal-aside-label">Add to Shopify store</div>
                {!tokenPresent ? (
                  <p className="dim small" style={{ marginTop: "0.3rem" }}>
                    <button className="link-btn" onClick={onGoShopify}>Sign in</button> to push products to your store.
                  </p>
                ) : !product?.id || !/^[0-9a-fA-F]{24}$/.test(String(product.id)) ? (
                  <p className="dim small" style={{ marginTop: "0.3rem" }}>
                    This product isn't saved to the database yet.
                  </p>
                ) : !shopifyConnected ? (
                  <button
                    className="bright-shopify-connect-btn"
                    onClick={onGoShopify}
                  >
                    <span className="bright-shopify-btn-icon">🛍</span>
                    Connect Shopify store
                  </button>
                ) : (
                  <BrightAsidePushButton
                    productId={String(product.id)}
                    shopifyPushing={shopifyPushing}
                    onPushToShopify={onPushToShopify}
                  />
                )}
              </div>
            </aside>

            <div className="bright-modal-detail">
              {(mainLink || extraLinks.length > 0) ? (
                <BrightModalPanel title="Outbound links" variant="highlight">
                  <div className="bright-links-row">
                    {mainLink ? (
                      <a
                        className="bright-link-primary"
                        href={mainLink}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="bright-link-primary-icon">↗</span>
                        <span className="bright-link-primary-text">
                          <span className="bright-link-primary-label">{mainLinkCaption || "Open link"}</span>
                          <span className="bright-link-primary-hint">Opens in a new tab</span>
                        </span>
                      </a>
                    ) : null}
                    {extraLinks.length > 0 ? (
                      <div className="bright-links-secondary">
                        {extraLinks.map(({ k, href }) => (
                          <a key={k} className="bright-link-chip" href={href} target="_blank" rel="noopener noreferrer">
                            {brightDataLabel(k)} ↗
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </BrightModalPanel>
              ) : null}


              {scalarEntries.length > 0 ? (
                <BrightModalPanel title="At a glance">
                  <BrightDataScalarMetrics entries={scalarEntries} />
                </BrightModalPanel>
              ) : null}

              {blockKeys.length > 0 ? (
                <div className="bright-modal-section-label">Structured fields</div>
              ) : null}

              {blockKeys.map((k) => (
                <BrightModalPanel title={brightDataLabel(k)} key={k}>
                  <BrightDataFieldBlock fieldKey={k} value={product[k]} depth={0} />
                </BrightModalPanel>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreatorInline({ creator, backendUrl }) {
  if (!creator) return null;
  const proxyAvatar = absUrl(backendUrl, creator.avatarProxyUrl);
  return (
    <div className="creator-row big">
      <MediaImage
        srcs={[proxyAvatar, creator.avatarUrl]}
        alt={creator.handle || ""}
        className="creator-avatar big"
        initials={(creator.handle || "?").slice(0, 1).toUpperCase()}
      />
      <div className="creator-meta">
        <div className="creator-handle">{creator.displayName || creator.handle} {creator.verified ? "✓" : ""}</div>
        <div className="creator-sub">@{creator.handle} · {compactNumber(creator.followers)} followers · {creator.region || "—"}</div>
        {creator.bio ? <p className="dim small clamp-2">{creator.bio}</p> : null}
      </div>
    </div>
  );
}

// ── Shared building blocks ───────────────────────────────────────────────────

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p className="dim">{subtitle}</p> : null}
      </div>
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}

function Pager({ pagination, pageNum, maxPages, onGoto }) {
  if (!pagination) return null;
  return (
    <div className="pager">
      <p className="dim small">{paginationLabel(pagination)}</p>
      <div className="actions">
        <button onClick={() => onGoto(1)} disabled={pageNum <= 1}>« First</button>
        <button onClick={() => onGoto(pageNum - 1)} disabled={pageNum <= 1}>‹ Prev</button>
        <span className="page-count">{pageNum} / {maxPages}</span>
        <button onClick={() => onGoto(pageNum + 1)} disabled={pageNum >= maxPages}>Next ›</button>
        <button onClick={() => onGoto(maxPages)} disabled={pageNum >= maxPages}>Last »</button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <article className="stat">
      <p className="label">{label}</p>
      <p className="value">{value}</p>
    </article>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value ?? "-"}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </div>
  );
}

function Bar({ label, value }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="bar">
      <div className="bar-head"><span>{label}</span><span>{pct.toFixed(0)}%</span></div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div className="block">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function EmptyState({ text }) {
  return <div className="empty">{text}</div>;
}

// ── Loading + error primitives ───────────────────────────────────────────────

function Skeleton({ className = "", style }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

function CardSkeleton({ tall }) {
  return (
    <div className="card skeleton-card" aria-busy="true">
      <Skeleton className="skel-media" />
      <div className="skel-body">
        <Skeleton className="skel-line w-80" />
        <Skeleton className="skel-line w-50" />
        {tall ? <Skeleton className="skel-block" /> : null}
        <div className="skel-row">
          <Skeleton className="skel-chip" />
          <Skeleton className="skel-chip" />
          <Skeleton className="skel-chip" />
        </div>
      </div>
    </div>
  );
}

function GridSkeleton({ count = 6, tall }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} tall={tall} />)}
    </>
  );
}

function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert">
      <div>
        <strong>Something went wrong.</strong>
        <p className="dim small">{message}</p>
      </div>
      {onRetry ? <button onClick={onRetry}>Retry</button> : null}
    </div>
  );
}

// ── MediaImage ───────────────────────────────────────────────────────────────
//
// `<MediaImage>` chains URLs (e.g. proxy → original → ultimate fallback) and
// shows a skeleton while loading + a placeholder/initials when every URL fails.
// Used everywhere we display TikTok / EchoTik imagery so a single broken URL
// never leaves a broken-image icon on the page.

function MediaImage({ srcs, alt = "", className = "", placeholder = "No preview", initials, eager }) {
  const list = (srcs || []).filter(Boolean);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setIdx(0); setLoaded(false); }, [list.join("|")]);

  if (list.length === 0 || idx >= list.length) {
    if (initials) {
      return <div className={`media-fallback initials ${className}`}>{initials}</div>;
    }
    return <div className={`media-placeholder ${className}`}>{placeholder}</div>;
  }

  return (
    <div className={`media-img-wrap ${className}`}>
      {!loaded && <div className="media-skeleton skeleton" aria-hidden="true" />}
      <img
        src={list[idx]}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        onLoad={() => setLoaded(true)}
        onError={() => { setLoaded(false); setIdx((i) => i + 1); }}
        style={loaded ? undefined : { opacity: 0 }}
      />
    </div>
  );
}

function absUrl(backendUrl, path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (backendUrl || "").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function SourcePill({ source, region, inline }) {
  if (!source && !region) return null;
  const label = [source ? source.toLowerCase() : null, region ? String(region).toUpperCase() : null].filter(Boolean).join(" · ");
  return <span className={`pill source ${inline ? "inline" : ""}`} title={`Source${region ? ` · region ${region}` : ""}`}>{label}</span>;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
