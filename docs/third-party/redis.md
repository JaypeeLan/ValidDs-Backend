# Redis Setup Guide

Redis is used in this project for **caching** and **background job queuing** (via BullMQ).

## Purpose

1.  **Caching**: Storing frequently accessed data (like API responses or TikTok product details) to reduce database load and improve response times.
2.  **Background Queues**: Powering the ingestion engine, which pulls data from TikTok in the background without blocking the main API.

## Configuration

ValidDs connects to Redis using a single environment variable:

- **`REDIS_URL`**: A standard Redis connection string.
  Format: `redis://[:password]@hostname:port` or `rediss://...` for TLS-enabled connections.

## Development Setup

For local development, you can run Redis using Docker:

```bash
docker-compose up -d redis
```

This will start a local Redis instance on `localhost:6379`. Set your `.env` to:
`REDIS_URL=redis://localhost:6379`

## Production/Staging Setup

You can use any Redis provider (Render Managed Redis, Railway, AWS ElastiCache, or a self-hosted instance). 

### Requirements:
- Ensure the instance is accessible from your deployment environment (e.g., within the same Render blueprint or via public network).
- If using a cloud provider, use the `rediss://` (TLS) protocol if supported for better security.

## Monitoring

You can monitor Redis usage using tools like:
- **Redis Insight**: A desktop GUI for managing and viewing Redis data.
- **`redis-cli`**: Command-line tool.
- **Provider Dashboard**: Most managed services provide usage stats.
