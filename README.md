# ValidDs Backend

ValidDs is a product research and validation platform for dropshippers.
It collects, processes, and serves TikTok product data — including trending products, video performance signals, competitor stores, and supplier references — through a clean API that powers the ValidDs frontend.

---

## What This Repository Is

This repository contains the backend server for ValidDs. It handles:

- Pulling product and trend data from TikTok data sources
- Storing and organising that data in a database
- Serving it to the frontend through a set of API endpoints
- Keeping the data fresh and monitoring the system health

You do not need to understand all of that to get started. If you are a developer joining the project, the [Getting Started](#getting-started) section below will have you running locally in a few minutes.

---

## Technology Stack

| Layer          | Technology           | Why                                 |
| -------------- | -------------------- | ----------------------------------- |
| Language       | TypeScript (Node.js) | Type safety, strong ecosystem       |
| Framework      | Express              | Lightweight, well-understood        |
| Database       | MongoDB Atlas        | Flexible schema, generous free tier |
| Cache & Queues | Redis (Upstash)      | Fast cache + background job queuing |
| Deployment     | Render               | Simple free-tier cloud deployment   |
| Error Tracking | Sentry               | Real-time error visibility          |
| Metrics        | Prometheus + Grafana | System performance monitoring       |

---

## Getting Started

### Prerequisites

You will need the following installed on your machine:

- [Node.js](https://nodejs.org/) version 18 or higher
- [npm](https://www.npmjs.com/) version 9 or higher
- [Docker](https://www.docker.com/) (optional — for running MongoDB and Redis locally)
- [Git](https://git-scm.com/)

### 1. Clone the repository

```bash
git clone <repo-url>
cd valids-backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. See the [Third-Party Setup Guides](#third-party-service-setup) section below for instructions on getting credentials for each service.

At minimum you need:

- `MONGODB_URI` — your MongoDB Atlas connection string
- `REDIS_URL` — your Upstash Redis URL
- `INTERNAL_API_KEY` — generate one by running `npm run generate-api-key`
- `JWT_SECRET` — any random string of 32+ characters
- `ENCRYPTION_KEY` — 64 hex characters (32 bytes). Generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

### 4. Start the development server

```bash
npm run dev
```

The API will be available at `http://localhost:3000`.

### 5. Verify it is running

```bash
curl http://localhost:3000/health
```

You should see:

```json
{ "status": "ok", "timestamp": "...", "uptime": 12.3 }
```

---

## Project Structure

```
src/
├── api/          Routes and controllers for each feature (products, videos, trends...)
├── services/     Business logic
├── db/           Database connection and data access
├── models/       Data schemas
├── ingestion/    TikTok data acquisition and processing
├── jobs/         Scheduled background tasks
├── queue/        Background job queues (BullMQ)
├── cache/        Redis caching layer
├── middleware/   Express middleware (auth, rate limiting, security...)
├── monitoring/   Error tracking and performance metrics
├── security/     Encryption, API keys, JWT
├── logger/       Custom structured logging
├── freshness/    Data freshness and stale-data handling
└── utils/        Shared utilities
```

For deeper technical detail, see the [docs/](./docs/) folder.

---

## Available Scripts

| Command                    | What it does                                         |
| -------------------------- | ---------------------------------------------------- |
| `npm run dev`              | Start the server in development mode with hot reload |
| `npm run build`            | Compile TypeScript to JavaScript                     |
| `npm start`                | Run the compiled production build                    |
| `npm test`                 | Run the test suite                                   |
| `npm run test:coverage`    | Run tests with coverage report                       |
| `npm run generate-api-key` | Generate a new internal API key                      |
| `npm run seed`             | Seed the database with sample data                   |
| `npm run test-ingestion`   | Manually trigger a data ingestion run                |

---

## API Endpoints

All API endpoints are prefixed with `/api/v1`.

| Endpoint                   | Description                                   |
| -------------------------- | --------------------------------------------- |
| `GET /health`              | Liveness check — is the server running?       |
| `GET /ready`               | Readiness check — are all services connected? |
| `GET /api/v1/products`     | Product feed                                  |
| `GET /api/v1/products/:id` | Product detail                                |
| `GET /api/v1/trends`       | Trend data                                    |
| `GET /api/v1/videos`       | Video data                                    |
| `GET /api/v1/stores`       | Competitor store data                         |
| `GET /api/v1/suppliers`    | Supplier/sourceability data                   |

Full endpoint documentation with request/response shapes is in [docs/endpoints.md](./docs/endpoints.md).

### Registration Flow (Email)

Local registration uses a 3-step flow:

1. `POST /api/v1/auth/register`
   - Body: `{ "email": "user@example.com" }`
   - Sends a 6-digit verification code to email.

2. `POST /api/v1/auth/email/verify-code`
   - Body: `{ "email": "user@example.com", "code": "123456" }`
   - Verifies code and marks email as verified.

3. `POST /api/v1/auth/register/complete`
   - Body: `{ "email": "user@example.com", "name": "Jane Doe", "password": "Password1" }`
   - Completes account setup and returns JWT + user payload.

---

## Third-Party Service Setup

Each service used by this project has a dedicated setup guide in the [docs/third-party/](./docs/third-party/) folder.

| Service              | Purpose                | Guide                                                                            |
| -------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| MongoDB Atlas        | Primary database       | [docs/third-party/mongodb-atlas.md](./docs/third-party/mongodb-atlas.md)         |
| Upstash Redis        | Caching and job queues | [docs/third-party/upstash-redis.md](./docs/third-party/upstash-redis.md)         |
| Sentry               | Error tracking         | [docs/third-party/sentry.md](./docs/third-party/sentry.md)                       |
| Prometheus + Grafana | Performance metrics    | [docs/third-party/prometheus.md](./docs/third-party/prometheus.md)               |
| Render               | Cloud deployment       | [docs/third-party/render-deployment.md](./docs/third-party/render-deployment.md) |
| BullMQ               | Background job queues  | [docs/third-party/bullmq.md](./docs/third-party/bullmq.md)                       |

---

## Security

This project takes security seriously. Key protections include:

- **HTTPS only** in staging and production
- **Helmet** security headers on every response
- **CORS** restricted to an explicit allowlist of origins
- **Rate limiting** on all routes
- **Input sanitization** to prevent MongoDB injection and XSS attacks
- **API key hashing** — raw keys are never stored, only SHA-256 hashes
- **AES-256-GCM encryption** for sensitive fields in the database
- **JWT authentication** for user-facing routes

If you discover a security issue, please report it privately rather than opening a public issue.

---

## Documentation

| Document                                         | Contents                                     |
| ------------------------------------------------ | -------------------------------------------- |
| [Architecture](./docs/architecture.md)           | System design, components, and key decisions |
| [Schema](./docs/schema.md)                       | Database schema for all entities             |
| [Endpoints](./docs/endpoints.md)                 | Full API reference                           |
| [Data Acquisition](./docs/data-acquisition.md)   | TikTok data sources and fallback strategy    |
| [Environment Setup](./docs/environment-setup.md) | Full local setup walkthrough                 |
| [Monitoring](./docs/monitoring.md)               | Logging, metrics, and alerting               |
| [Risks](./docs/risks.md)                         | Known risks and open issues                  |
| [Decision Log](./docs/decision-log.md)           | Key technical decisions and reasoning        |

---

## Contributing

This is an internal project. If you are joining the team, reach out to the project lead for access and onboarding.

---

_Built for ValidDs by Supreme Ecom_
