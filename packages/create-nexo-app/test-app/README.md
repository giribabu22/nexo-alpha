<p align="center">
  <img src="https://raw.githubusercontent.com/giribabu22/nexo-alpha/main/logo.png" alt="Nexo - The AI Application Framework" width="140">
</p>

# test-app

A full-stack application powered by **Nexo — The AI Application Framework** backend and **React (Vite)** frontend.

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Servers
```bash
npm run dev
```
This concurrently launches:
- **Backend (Nexo + Hapi)** on http://localhost:4000
- **Frontend (React + Vite)** on http://localhost:5173

### 3. Production Build & Docker
```bash
# Build locally
npm run build
npm start

# Or run in Docker container
docker build -t test-app .
docker run -p 4000:4000 test-app
```

## Architecture

- `backend/`: Nexo application model with modules, APIs, services, and lifecycle.
- `frontend/`: React 18 + Vite client interacting with Nexo backend APIs.

## Nexo CLI

Run these from `backend/` (or via `npm --workspace=backend run <script>` from the root):
```bash
npx nexo inspect
npm run graph
npx nexo impact <nodeId>
npx nexo freshness --source-root src
```
