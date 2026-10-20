# Sabah Koşusu PC backup service

This directory contains a small **Node.js 22+**, built-in-modules-only backup service for the PWA. The iPhone PWA remains the primary data source: it writes completed runs and GPS points to IndexedDB, queues an outbox item, and retries while the app is open and the PC is reachable. The PC service does not depend on iOS background sync.

No PC has been configured and no credentials are included in this repository. The files below describe what an operator can configure locally.

## Setup

1. Install Node.js 22 or newer on the PC.
2. Copy `.env.example` to `.env` in this directory.
3. Generate secrets locally, for example:

   ```sh
   openssl rand -hex 32       # put the output in AUTH_TOKEN
   openssl rand -base64 32    # put the output in BACKUP_ENCRYPTION_KEY
   ```

   `AUTH_TOKEN` must be a long random Bearer token. `BACKUP_ENCRYPTION_KEY` must decode from base64 to exactly 32 bytes. The encryption key and Telegram bot credentials stay only on the PC. Enter the Bearer token in the PWA's password field so it can authenticate requests; it is stored in that phone's local IndexedDB and must never be committed to source code, screenshots, shell history, or logs.

4. Set `ALLOWED_ORIGIN` to the **exact** browser origin of the PWA (scheme, host, and port; no path). The server never enables wildcard CORS.
5. Optionally set both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. If either is absent, local sync continues and Telegram is reported as disabled.
6. Start the service:

   ```sh
   node server.mjs
   ```

   The default bind is `127.0.0.1:8787`. The server refuses to start without a sufficiently random `AUTH_TOKEN`.

To make a daily encrypted backup immediately, without starting the HTTP server, run:

```sh
node server.mjs --backup-now
```

While running, the service performs one backup shortly after local midnight. On ordinary startup it checks the local date and catches up if that date has not been successfully sent to Telegram. The PC must be powered on and online for that schedule; a missed run is not an iOS background task and is retried at the next PC start. A local encrypted backup is still created when Telegram credentials are absent, but it is recorded as Telegram-disabled rather than falsely marked as sent.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `HOST` | Listen address; defaults to `127.0.0.1`. Do not change to `0.0.0.0` unless a separate private network boundary is intentional. |
| `PORT` | HTTP port; defaults to `8787`. |
| `ALLOWED_ORIGIN` | One exact allowed PWA origin. Requests with another `Origin` are rejected. Requests without `Origin` (for example local administration) can still use the API. |
| `AUTH_TOKEN` | PC-side random Bearer token required for every API route except `/health`. |
| `BACKUP_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes for AES-256-GCM daily backup files. |
| `TELEGRAM_BOT_TOKEN` | PC-side Telegram Bot API token. Never send this to the PWA. |
| `TELEGRAM_CHAT_ID` | Destination chat ID used by `sendDocument`. |
| `MAX_BODY_BYTES` | Maximum JSON request body; defaults to 8 MiB. |
| `TELEGRAM_TIMEOUT_MS` | Telegram upload timeout; defaults to 20 seconds. |
| `DATA_DIR` | Run storage directory, default `data`. Each run is an atomic, mode-0600 JSON file under `data/runs/`. |
| `BACKUP_DIR` | Encrypted daily backup directory, default `backups`. |

## HTTP API

All API routes require `Authorization: Bearer <AUTH_TOKEN>` and `Content-Type: application/json` for POST requests.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Public liveness/configuration summary. It does not expose run data or secrets. |
| `POST` | `/api/v1/runs` | Idempotently store one completed run. `/api/runs` is an alias. |
| `POST` / `GET` | `/api/v1/state` | Store or read track names, weekly goals/streak/flex state, and sanitized preferences. `/api/state` is an alias. |
| `GET` | `/api/v1/export` | Authenticated JSON export of runs plus app state. `/api/export` is an alias. |
| `GET` | `/api/v1/sync` | Authenticated export/sync view; same data shape as export. |
| `POST` | `/api/v1/sync` | Import a bounded `{ "runs": [...] }` batch idempotently. |
| `POST` | `/api/v1/import` or `/api/v1/restore` | Authenticated restore/import aliases accepting `{ "runs": [...] }`. |
| `POST` | `/api/v1/backup` | Authenticated manual encrypted daily backup and Telegram attempt. |

The PWA currently posts this IndexedDB-compatible shape to `/api/v1/runs`:

```json
{
  "schemaVersion": 1,
  "run": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "startedAt": 1710000000000,
    "endedAt": 1710001800000,
    "distanceM": 5000
  },
  "routePoints": [
    {
      "runId": "550e8400-e29b-41d4-a716-446655440000",
      "sequence": 0,
      "timestamp": 1710000000000,
      "latitude": 41.01,
      "longitude": 28.97,
      "accuracyM": 8
    }
  ],
  "starEvents": []
}
```

The service requires a UUID, `status: "completed"`, valid GPS ranges, finite numeric measurements, matching point/event run IDs, unique point sequences, and bounded arrays. Repeating the same UUID and payload returns success without rewriting it. Reusing the UUID with different data returns `409`. Invalid JSON, media types, payloads, and bodies over the configured limit are rejected.

After sending queued runs, the PWA also posts the current `tracks`, `weeklyProgress` (including the monthly flex decision), and user preferences to `/api/v1/state`. The PC never stores the PWA's backup Bearer token, PC URL, or enabled flag in that state. `GET /api/v1/export` and the encrypted daily archive include this app state alongside every stored run and its GPS points/star events.

## Backup and Telegram behavior

The service creates `backups/runs-YYYY-MM-DD.json.gz.enc`. The plaintext export contains all stored run records, GPS points, star events, track names/records, weekly goals/streak/flex state, and sanitized user preferences. It is gzip-compressed and then encrypted with AES-256-GCM using the configured 32-byte key. Only the encrypted JSON envelope is passed to Telegram; the service never uploads the plaintext JSON or gzip stream. A small local manifest records whether that date was sent, and is also mode-0600.

A Telegram bot sends to a **bot-initiated private chat**, group, or channel identified by `TELEGRAM_CHAT_ID`; it does **not** send directly to a phone number. For a private chat, start or otherwise initiate the conversation with the bot first, then determine the chat ID. Keep the bot token on the PC.

## Private HTTPS / remote access

The default loopback bind is deliberate. If the phone must reach the PC, use a private, access-controlled path such as Tailscale, a VPN, or a private HTTPS reverse proxy/tunnel with authentication and an allow-list. Keep the Node service on loopback where possible and terminate HTTPS at the private proxy. **Do not router-port-forward this service to the public internet.** The PWA should use an HTTPS URL except for local development on `localhost`/`127.0.0.1`; the service's Bearer token remains required even on a private network.

## Tests

From this directory:

```sh
node --test server.test.mjs
```

The test suite uses temporary directories and an injected Telegram sender; it does not contact Telegram or require real credentials.
