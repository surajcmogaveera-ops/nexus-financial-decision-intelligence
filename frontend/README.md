# NEXUS frontend

Next.js App Router foundation for NEXUS. The browser communicates only with the Node/Express application API. It does not contain financial calculations or call FastAPI.

## Local development

1. Copy `.env.local.example` to `.env.local` if the Node API is not at its default URL.
2. Configure the backend's `FRONTEND_ORIGIN` as `http://127.0.0.1:3001` (and run the browser at that same host) so credentialed cookie requests are allowed.
3. Start the Node backend on port 3000.
4. Run `pnpm install`, then `pnpm dev` here. Open `http://127.0.0.1:3001`.

The authenticated dashboard requires a profile for Financial Twin data. If none exists, it shows the backend's `FINANCIAL_PROFILE_NOT_FOUND` state without creating a profile or displaying placeholder financial values.
