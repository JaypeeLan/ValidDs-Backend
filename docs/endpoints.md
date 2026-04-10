# ValidDs Backend — Endpoint Documentation

This document officially details the core REST API endpoints mandated for the ValidDs V1 application. It outlines the required request shapes and returned responses.

All endpoints are standardized using the generic envelope structure defined in `api-responses.md`.

---

## 1. Product Feed Endpoint

Returns a paginated list of trending products. Sorting and filtering are supported.

**Endpoint:** `GET /api/v1/products`  
**Authentication:** Optional (Unauthenticated users get standard access; authenticated users are tracked against a quota).

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | `Number` | No | Page number (Defaults to 1). |
| `limit` | `Number` | No | Items per page (Defaults to 20, max 100). |
| `category` | `String` | No | Filters results by canonical category (e.g., `Home & Kitchen`). |
| `sortBy` | `String` | No | Can be `engagementRate`, `unitsSold`, `price`. (Defaults to `engagementRate`). |
| `order` | `String` | No | Can be `asc` or `desc`. (Defaults to `desc`). |

### Response Example

```json
{
  "success": true,
  "message": "Products retrieved successfully",
  "statusCode": 200,
  "data": {
    "products": [
      {
        "_id": "60d21b4667d0d8992e610c85",
        "title": "Smart LED Desk Lamp",
        "primaryImageUrl": "https://m.media-amazon.com/images/I/71ki1pGu0GL.jpg",
        "price": 39.99,
        "unitsSold": 15000,
        "store": "TeemDrop",
        "engagementRate": 14.5
      }
    ],
    "pagination": {
      "total": 350,
      "page": 1,
      "limit": 20,
      "hasMore": true
    },
    "freshness": {
      "lastUpdated": "2026-04-10T15:00:00.000Z",
      "ageMinutes": 45
    }
  }
}
```

---

## 2. Product Detail Endpoint

Returns comprehensive data for a single product, including AI extraction metadata, subdocuments, and validating video data.

**Endpoint:** `GET /api/v1/products/:id`  
**Authentication:** Optional

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | `String` | Yes | MongoDB `ObjectId` of the product. |

### Response Example

```json
{
  "success": true,
  "message": "Product retrieved successfully",
  "statusCode": 200,
  "data": {
    "_id": "60d21b4667d0d8992e610c85",
    "externalId": "7334812349814455",
    "source": "tiktok",
    "title": "Smart LED Desk Lamp",
    "description": "A wireless charging LED desk lamp perfect for modern setups.",
    "category": "Home & Kitchen",
    "price": 39.99,
    "unitsSold": 15000,
    "store": "TeemDrop",
    "rating": 4.6,
    "reviewsCount": 8500,
    "topVideos": [
      {
        "videoId": "7334812349814455",
        "playUrl": "https://v77.tiktokcdn.com/.../video.mp4",
        "viewCount": 2500000,
        "likeCount": 500000,
        "commentCount": 15000,
        "shareCount": 50000,
        "isAd": false
      }
    ],
    "aiExtraction": {
      "confidence": 95,
      "trendReason": "Extremely high comment-to-share ratio with high purchase intent.",
      "sentimentSummary": "Users are actively asking 'link please' and 'where to buy'."
    }
  }
}
```

---

## 3. Product Search Endpoint

Performs a full text search across product titles and tags.

**Endpoint:** `GET /api/v1/products/search`

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | `String` | Yes | The search query string. |
| `page` | `Number` | No | Pagination page. |

---

## 4. Categories List Endpoint

Returns a distinctly mapped array of all existing product categories found within the active product directory. Essential for building the frontend filtering UI.

**Endpoint:** `GET /api/v1/products/categories`

### Response Example

```json
{
  "success": true,
  "message": "Categories retrieved",
  "statusCode": 200,
  "data": [
    "Home & Kitchen",
    "Tech Gadgets",
    "Beauty & Personal Care",
    "Fitness & Health"
  ]
}
```
