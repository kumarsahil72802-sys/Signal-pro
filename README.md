# Signal

Signal is a full-stack crypto signal observatory with:

- real-time market snapshot and quality insights,
- signal lifecycle tracking (active, taken, closed),
- performance stats and learning diagnostics,
- a React dashboard for monitoring and action.

## Repository Structure

```text
signal/
  client/   # React + Vite frontend
  server/   # Node.js + Express + MongoDB backend
```

## Documentation Map

- Frontend guide: [client/README.md](./client/README.md)
- Backend guide: [server/README.md](./server/README.md)
- Server deployment notes: [server/DEPLOYMENT.md](./server/DEPLOYMENT.md)

## Quick Start (Local)

### 1) Prerequisites

- Node.js 22 LTS (recommended)
- npm
- MongoDB (local or cloud)

### 2) Backend Setup

```bash
cd server
npm install
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Set at least:

- `MONGO_URI`
- `PORT` (optional, default `5000`)
- `NODE_ENV` (`development` for local)
- `CORS_ORIGINS` (optional in local, required in production)

Run backend:

```bash
npm run dev
```

### 3) Frontend Setup

In a new terminal:

```bash
cd client
npm install
```

Create `.env` (optional) to point UI to backend:

```bash
VITE_API_BASE_URL=http://localhost:5000/api
```

Run frontend:

```bash
npm run dev
```

### 4) Open App

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:5000/health`

## API Base Paths

- `/api/signals`
- `/api/market`
- `/api/news`

## Production Notes

- Keep secrets only in environment variables (never commit `.env`).
- Configure CORS and proxy trust correctly before deployment.
- Use PM2 + reverse proxy as described in `server/DEPLOYMENT.md`.
