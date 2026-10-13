# MeraFarm API (NestJS)

## What's actually implemented here

- **Campaigns** — create, list live campaigns, get one, update the unit cap
  live, go-live. The price-ladder math (`src/campaigns/pricing.util.ts`) is
  ported 1:1 from the prototype, with unit tests, and is the same function
  used everywhere pricing is computed (listing cards, product page, checkout).
- **Auth** — phone + OTP (console-logged in dev — see `otp.service.ts`) and
  password login, JWT sessions. Mirrors the prototype's sign-in/sign-up split.
- **Orders / checkout** — reserving units against a campaign's cap inside a
  DB transaction (fixes the race-condition gap the prototype's client-side
  state couldn't guarantee), Razorpay order creation + payment verification.
- **Automatic refunds** — the moment any order is confirmed, every other
  confirmed order on that campaign that paid more than the now-current price
  gets a refund queued via BullMQ and actually processed through Razorpay's
  refund API. This is the server-side version of the prototype's "your order
  unlocks this price for everyone" logic.
- **Realtime** — a Socket.IO gateway (`/campaigns` namespace) broadcasting
  `campaign:update` to everyone subscribed to a campaign room whenever its
  booked units change.
- **Complaints** — raise and list, scoped to the owning order.

## What's deliberately stubbed / not built yet

- **Cart, refunds/complaints listing endpoints beyond the basics, referral
  gamification points/badges endpoints, user profile/address-book CRUD,
  seller dashboard analytics, media upload (S3), order-expiry for abandoned
  PENDING_PAYMENT orders** (needs a delayed BullMQ job to release reserved
  units if payment is never confirmed — flagged in code, not implemented).
- **Password hashing uses SHA-256 as a placeholder** — swap for bcrypt/argon2
  before this touches a real password.
- **RBAC is minimal** — campaign write endpoints check `sellerId` ownership,
  but there's no admin role yet for cross-seller admin actions.
- Test coverage is limited to the pricing utility, which is the highest-risk
  logic. Everything else needs integration tests before this is production-safe.

## Running locally

This sandbox has no network access, so none of this has been `npm install`'d
or run — please do that on your machine:

```bash
# from the merafarm/ folder
docker compose up -d          # starts Postgres + Redis
cd backend
cp .env.example .env          # fill in JWT_SECRET, Razorpay keys, etc.
npm install
npm run prisma:migrate        # creates the schema
npm run seed                  # seeds the demo Alphonso campaign
npm run start:dev             # http://localhost:4000/api
```

## Key endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/request-otp` | — | rate-limited to 3/min per IP |
| POST | `/api/auth/verify-otp` | — | creates the account if the phone is new |
| POST | `/api/auth/login` | — | password login for a returning user |
| GET | `/api/campaigns` | — | live campaigns, optional `?city=` |
| GET | `/api/campaigns/:id` | — | full detail incl. computed price/slabs |
| POST | `/api/campaigns` | seller | create with slabs |
| PATCH | `/api/campaigns/:id/cap` | seller | live-editable cap |
| POST | `/api/campaigns/:id/go-live` | seller | |
| POST | `/api/orders` | buyer | reserves units, returns Razorpay order |
| POST | `/api/orders/:id/confirm` | buyer | verifies payment, triggers refund reconciliation |
| GET | `/api/orders/me` | buyer | |
| POST | `/api/complaints` | buyer | |
