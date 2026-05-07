# API Response Format

All ValidDs API endpoints return standardized success and error response formats for consistency and predictability.

## Success Response Format

Every successful API request returns:

```json
{
  "success": true,
  "message": "Descriptive success message",
  "statusCode": 200,
  "data": { /* endpoint-specific data */ }
}
```

### Fields
- **success** (boolean): Always `true` for successful responses
- **message** (string): Human-readable description of what happened (pulled from `ResponseMessage` enum)
- **statusCode** (number): HTTP status code (200, 201, etc.)
- **data** (T): The actual response payload, type varies by endpoint

## Available Response Messages

The `ResponseMessage` enum defines all possible success messages:

| Message | Meaning |
|---------|---------|
| `REGISTRATION_STARTED` | User email verified, registration in progress |
| `LOGIN_SUCCESS` | User successfully authenticated |
| `LOGOUT_SUCCESS` | User session terminated |
| `PROFILE_RETRIEVED` | User profile fetched |
| `PROFILE_UPDATED` | User profile updated |
| `PRODUCTS_RETRIEVED` | Product list fetched |
| `PRODUCT_RETRIEVED` | Single product fetched |
| `PRODUCT_CREATED` | New product created |
| `PRODUCT_UPDATED` | Product updated |
| `PRODUCT_DELETED` | Product deleted |
| `HEALTH_OK` | System is healthy |
| `SUCCESS` | Generic success |
| `CREATED` | Resource created |
| `UPDATED` | Resource updated |
| `DELETED` | Resource deleted |

## Example Endpoints

### GET /api/v1/health
```json
{
  "success": true,
  "message": "Health OK",
  "statusCode": 200,
  "data": { "timestamp": "2026-04-01T12:00:00Z" }
}
```

### POST /api/v1/auth/login
```json
{
  "success": true,
  "message": "Login successful",
  "statusCode": 200,
  "data": {
    "user": {
      "id": "user-123",
      "email": "user@example.com",
      "name": "John Doe"
    },
    "session": {
      "token": "eyJhbG...",
      "expiresIn": 86400
    }
  }
}
```

### GET /api/v1/products/feed
```json
{
  "success": true,
  "message": "Products retrieved",
  "statusCode": 200,
  "data": {
    "products": [
      {
        "id": "prod-123",
        "title": "Product Name",
        "source": "tiktok"
      }
    ],
    "pagination": {
      "total": 500,
      "page": 1,
      "limit": 20,
      "hasMore": true
    },
    "freshness": {
      "lastUpdated": "2026-04-01T11:30:00Z",
      "ageMinutes": 30
    }
  }
}
```

## Error Response Format

Error responses follow a different format. See error handling documentation for details.

## Frontend Integration

Frontend code should:
1. Check `success` flag first — if `false`, handle error
2. Use `message` to show user feedback
3. Extract data from `data` field
4. Use `statusCode` for logging/debugging (though HTTP status code is also available in response headers)

### Example Frontend Usage (TypeScript)

```typescript
async function fetchProducts() {
  const response = await fetch('/api/v1/products/feed');
  const result = await response.json();

  if (!result.success) {
    showError(result.message);
    return;
  }

  // All responses have the same structure
  console.log(result.message); // "Products retrieved"
  console.log(result.statusCode); // 200
  console.log(result.data.products); // actual data
}
```

## Implementation Details

Response messages are centralized in `src/utils/response.util.ts`:

```typescript
export enum ResponseMessage {
  REGISTRATION_STARTED = "Registration started. Check your email for verification code.",
  LOGIN_SUCCESS = "Login successful",
  // ... etc
}

export function successResponse<T>(
  data: T,
  message: string,
  statusCode: number = 200
) {
  return {
    success: true,
    message,
    statusCode,
    data,
  };
}
```

All controllers use `successResponse()` to wrap responses, ensuring consistency.

### Adding New Messages

To add a new success message:
1. Add entry to `ResponseMessage` enum in `src/utils/response.util.ts`
2. Import and use in controller:
   ```typescript
   return res.status(201).json(
     successResponse(newProduct, ResponseMessage.PRODUCT_CREATED, 201)
   );
   ```
3. Update this documentation

No other files need changes — the system is backward compatible.
