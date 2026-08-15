# Trip Portal

旅行ごとに独自デザインのポータルを提供し、旅行データはSupabaseで共有・管理するアプリです。

## Architecture

- `app/`: 共通ルーティングと画面
- `components/`: 旅行機能の共通UI
- `lib/`: 認証、DB、計算ロジック
- `sites/`: 旅行ごとのデザイン層
- `supabase/migrations/`: DBスキーマとRLS
- `shikoku-saburo-bbq-2026/`: 既存費用計算画面（DB移行までの互換層）

旅行ごとにコード全体を複製せず、共通機能を再利用します。旅行固有のテーマ、レイアウト、説明文は `sites/` に分離し、旅行データはDBの `trips` と関連テーブルで管理します。

## Current site

- Canonical portal: `/trips/shikoku-saburo-bbq-2026`
- Legacy duplicate route `/trips/shikoku-saburo-2026` is removed.

## Database

Apply `supabase/migrations/0001_trip_portal.sql` to create the initial schema. The migration includes:

- trips and trip-scoped memberships
- member/admin roles and pending/approved/removed states
- itinerary, receipts, expenses, purchases, rentals, packing, and notes
- change logs
- row-level security for approved trip members
- optimistic concurrency `version` fields

## Environment

Copy `.env.example` to a local `.env.local` and fill in the Supabase and LINE Login values. Secrets must not be committed.

LINE Login is handled directly by the app's Worker, not by a Supabase Custom Auth Provider. Register the following callback URL in the LINE Login channel:

```text
http://localhost:3001/auth/callback
```

For production, register the deployed origin with the same `/auth/callback` path. `SUPABASE_SERVICE_ROLE_KEY`, `LINE_CHANNEL_SECRET`, and `LINE_AUTH_SECRET` are server-only secrets. The LINE provider settings in Supabase are not used by this application.

## Development

The repository currently uses the vinext/Vite runtime and Cloudflare-compatible worker entrypoint. Install dependencies before running the existing scripts:

```bash
npm install
npm run dev
```

The legacy budget screen still uses browser storage until the DB-backed expense editor is implemented.

## GitHub Pages cache policy

GitHub Pages releases must use build-versioned asset URLs. Keep `__BUILD_VERSION__` in source HTML/CSS asset URLs; `scripts/build-pages-config.mjs` replaces it with the deployment commit SHA during the Pages workflow. Do not replace the placeholder with a fixed date or manually incremented value.
