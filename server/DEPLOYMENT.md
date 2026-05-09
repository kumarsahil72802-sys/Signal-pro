# Signal Server Deployment (PM2 + Ubuntu)

## 1) Prepare Server
```bash
sudo apt update
sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

## 2) App Setup
```bash
git clone <your-repo-url> signal
cd signal/server
npm ci
cp .env.example .env
```

Fill `.env` with production values:
- `NODE_ENV=production`
- `MONGO_URI=<your-mongodb-uri>`
- `CORS_ORIGINS=https://your-frontend-domain`
- `SIGNAL_WRITE_API_KEY=<long-random-token>`
- `DISABLE_WRITE_AUTH=false`
- `SIGNAL_RECONCILE_ON_MONITOR=true`
- `SIGNAL_REPLAY_INTERVAL=1m`
- `SIGNAL_REPLAY_AMBIGUITY_POLICY=CONSERVATIVE`

## 3) Start with PM2
```bash
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
```

## 4) Auto-start on Reboot
```bash
pm2 startup
```
Run the command printed by PM2, then:
```bash
pm2 save
```

## 5) Health Checks
```bash
curl http://127.0.0.1:5000/health
curl http://127.0.0.1:5000/readyz
```

## 6) Nginx Reverse Proxy (Optional)
Use Nginx in front of Node and keep Node bound to private interface/port.
When behind proxy, set `TRUST_PROXY=true` in `.env`.

## 7) Update Flow
```bash
cd signal/server
git pull
npm ci
pm2 restart ecosystem.config.cjs --update-env
pm2 save
```
