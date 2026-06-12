# Signal Backend (Server)

Express + MongoDB backend for signal generation, monitoring, reconciliation, and API delivery.

For repository-level setup, see: [../README.md](../README.md).

## Stack

- Node.js
- Express
- MongoDB + Mongoose
- Node Cron
- External market providers and RSS news feeds via services

## Available Scripts

```bash
npm run dev    # Start with nodemon
npm start      # Start with node
npm test       # Run node test suite
```

## Setup

### 1) Install Dependencies

```bash
npm install
```

### 2) Configure Environment

Create env file from template:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Minimum required variables for local run:

- `MONGO_URI` (required)
- `PORT` (optional, default `5000`)
- `NODE_ENV=development`

Recommended for stable local frontend integration:

- `CORS_ORIGINS=http://localhost:5173`

### 3) Run

```bash
npm run dev
```

Default local URL:

- `http://localhost:5000`

## Health Endpoints

- `GET /health`
- `GET /readyz`

## Core API Routes

- `GET /api/signals`
- `GET /api/signals/all`
- `GET /api/signals/stats`
- `PATCH /api/signals/:id/take`
- `GET /api/market`
- `GET /api/market/quality`
- `GET /api/market/chart`
- `GET /api/news`

## Testing

```bash
npm test
```

Test files are under `server/tests/`.

## Production

Deployment playbook:

- [DEPLOYMENT.md](./DEPLOYMENT.md)

Before production launch, ensure:

- `NODE_ENV=production`
- `MONGO_URI` is production-grade
- `CORS_ORIGINS` is explicitly set
- proxy settings (`TRUST_PROXY`) are configured if behind Nginx/Cloudflare
