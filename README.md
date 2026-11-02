# MFP-backend

NestJS + Prisma API for Mahadeva Food Products (stock & sales). See `PROJECT_CONTEXT.md` in the frontend repo for the overall plan.

## Local development

Prerequisites: Node 24, Docker Desktop (running).

```bash
cp .env.example .env     # first time only
npm install              # also generates the Prisma client
npm run db:up            # start Postgres (localhost:5432, user/pass/db: mfp)
npm run start:dev        # API on http://localhost:4001
```

Check it: http://localhost:4001/health → `{"status":"ok","db":"up"}`

## Scripts

| Script | What it does |
|---|---|
| `npm run db:up` / `db:down` | Start / stop the local Postgres container (data is kept in a Docker volume) |
| `npm run db:migrate -- --name <name>` | Create + apply a migration from `prisma/schema.prisma`, then regenerate the client |
| `npm run db:studio` | Open Prisma Studio to browse and edit data |
| `npm run test:e2e` | End-to-end tests (needs `db:up`) |

## Corporate network (Zscaler)

If Prisma fails with `unable to get local issuer certificate`, point Node at the Zscaler root certificate:

```powershell
setx NODE_EXTRA_CA_CERTS "%USERPROFILE%\.certs\zscaler-root.pem"
```

## API (Module 1 – Workers)

| Method & path | Purpose |
|---|---|
| `GET /workers?includeInactive=true` | Workers with pay summary (payable, this period, pay due) |
| `GET /workers/overview` | Dashboard numbers |
| `POST /workers`, `GET/PATCH /workers/:id` | Create / view (with advances, pay history) / edit or archive (`active: false`) |
| `GET /workers/:id/attendance?month=YYYY-MM` | Calendar data |
| `GET /attendance?date=YYYY-MM-DD`, `PUT /attendance` | One day's attendance for all workers / save it |
| `POST /workers/:id/advances`, `DELETE /advances/:id` | Advances |
| `GET /workers/:id/settlement-preview?upTo=`, `POST /workers/:id/settlements` | Settle pay |

Pay rules are in `src/workers/pay.ts` (unit tested) and `src/workers/pay-summary.service.ts`.

## API (Module 2 – Stock)

| Method & path | Purpose |
|---|---|
| `GET /materials?type=RAW\|SUPPLY&includeInactive=true` | Materials with current stock, status (OK / LOW / NEGATIVE), last used date |
| `POST /materials`, `GET/PATCH /materials/:id` | Create (with optional opening stock) / view with history / edit or archive |
| `POST /materials/:id/purchases`, `POST /materials/:id/adjustments` | Add stock / correct stock (`quantity` change or `countedQty`) |
| `DELETE /stock/movements/:id` | Undo a purchase, adjustment or opening entry |
| `GET /stock/production?date=`, `PUT /stock/production` | Day-end usage for a date (PUT replaces the day; empty `items` removes it) |
| `GET /stock/overview`, `GET /stock/suppliers` | Dashboard numbers / supplier names used so far |

Every stock change goes through `applyMovement` / `reverseMovement` in `src/stock/stock.service.ts`, which keep `Material.currentQty` in sync inside the same transaction.

## API (Modules 3–5 – Products, Buyers, Sales)

| Method & path | Purpose |
|---|---|
| `GET /products`, `POST /products`, `GET/PATCH /products/:id` | Products with recipe, cost estimate, finished stock and history |
| `POST /products/:id/adjustments`, `DELETE /products/movements/:id` | Correct finished stock / undo an opening or adjustment |
| `PUT /stock/production` (`products: [...]`) | Day-end entry also records products made |
| `GET /buyers`, `POST /buyers`, `GET/PATCH /buyers/:id` | Buyers with balance, overdue amount and a timeline of invoices and payments |
| `POST /buyers/:id/payments`, `DELETE /payments/:id` | Money received (applied to oldest dues unless `allocations` are given) |
| `GET /sales?status=UNPAID\|OVERDUE\|PAID\|CANCELLED&q=`, `POST /sales`, `GET/PUT /sales/:id` | Invoices (create, view, edit with the same number) |
| `POST /sales/:id/mark-paid`, `POST /sales/:id/cancel` | Record payment for the amount due / cancel (stock returned) |
| `GET /settings/company`, `PUT /settings/company` | Business details printed on invoices |
| `GET /products/overview`, `/buyers/overview`, `/sales/overview` | Dashboard numbers |

Rules worth knowing:
- GST and totals: `src/sales/invoice-math.ts` (unit tested).
- Which invoices a payment settles: `LedgerService.reconcile` in `src/buyers/ledger.service.ts`.
- Finished stock changes only through `applyProductMovement` / `reverseProductMovement` (`src/products/product-stock.ts`).
