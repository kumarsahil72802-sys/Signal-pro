# Signal Frontend (Client)

React + Vite dashboard for monitoring market data, crypto news, signals, and performance stats.

For repository-level setup, see the root guide: [../README.md](../README.md).

## Stack

- React 19
- Vite 8
- MUI + Emotion
- Axios

## Available Scripts

```bash
npm run dev      # Start local dev server
npm run build    # Build production bundle
npm run preview  # Preview production build locally
npm run lint     # Run ESLint
```

## Setup

### 1) Install Dependencies

```bash
npm install
```

### 2) Configure Environment

Create `client/.env` (optional, but recommended):

```bash
VITE_API_BASE_URL=http://localhost:5000/api
```

If not set, the app defaults to `http://localhost:5000/api`.

### 3) Run

```bash
npm run dev
```

Default local URL:

- `http://localhost:5173`

## Frontend-Backend Contract

This client expects backend endpoints under `/api`:

- `GET /signals/all`
- `PATCH /signals/:id/take`
- `GET /signals/stats`
- `GET /market`
- `GET /market/quality`
- `GET /market/chart`
- `GET /news`

## Build for Production

```bash
npm run build
```

Output directory:

- `client/dist`

## Troubleshooting

- If API calls fail, verify backend is running on port `5000` or update `VITE_API_BASE_URL`.
- If CORS errors appear in production, update backend `CORS_ORIGINS`.
