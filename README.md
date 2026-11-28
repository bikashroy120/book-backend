<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

Hosonta Prokashon's NestJS API backend. Routes are private by default and use
JWT bearer authentication; public routes must be explicitly marked with
`@Public()`.

## Project setup

```bash
npm install
Copy-Item .env.example .env
```

Set `DATABASE_URL`, `FRONTEND_URL`, `ACCESS_TOKEN_SECRET`,
`REFRESH_TOKEN_SECRET`, and `MAIL_FROM` in `.env` before starting the API.
Token secrets should be unique, random values. `PORT`, token expiration values,
and `UPLOAD_DIR` have defaults documented in `.env.example`.

The API is served under `/api/v1`. `GET /api/v1/health` is public. Authenticated
users can upload images, PDFs, and manuscripts at `/api/v1/uploads/image`,
`/api/v1/uploads/pdf`, and `/api/v1/uploads/manuscript`; uploaded files are
available under `/uploads`.

Public authentication endpoints are under `/api/v1/auth`: `POST /register`,
`POST /login`, `POST /refresh`, `GET /verify-email`, `POST /forgot-password`,
and `POST /reset-password`. Login is limited to five attempts per minute per IP.
Verification and password-reset links are sent through the configured mail
transport; the current console transport logs delivery metadata only.

Authenticated users can manage their own profile and password under
`/api/v1/users/me`. User search, summary, detail, and staff-management routes
are restricted to admins; role changes are restricted to super admins. Staff
accounts receive a generated temporary password through the mail transport.

Authenticated users can manage up to ten of their own delivery addresses under
`/api/v1/addresses`. Deleting an address clears an order's optional `addressId`
reference (`ON DELETE SET NULL`); order shipping details remain on the order.

Author applications are available to readers at `/api/v1/author-applications`.
Admins review applications, and approved applicants receive an author profile.
Authors manage their profile and publishing-terms agreement at
`/api/v1/authors/me`; staff can browse the directory and approved profiles are
available at `/api/v1/public/authors/:id`.

Staff can browse publishers and publisher book/inventory summaries at
`/api/v1/publishers`; admins manage publisher records. The public
`/api/v1/categories` endpoint returns the category tree, and staff can manage
categories.

Staff manage book records, inventory metadata, and edit history under
`/api/v1/books`. Authors can view their own titles at `/api/v1/books/mine`.
Published titles are available publicly through `/api/v1/store/books`; scheduled
titles are published automatically when their scheduled time arrives.
Store book detail currently returns a null average rating and zero review count
until review aggregation is connected.

Staff manage inventory counts and stock movements under `/api/v1/stock`.
Stock history, alerts, summaries, alert limits, and a UTF-8 CSV export are
available in the same route group.

Staff manage shop records, counter-order totals, and POS dropdown options under
`/api/v1/shops`; deleting a shop with orders suspends it instead.

Customers can place, track, and cancel eligible orders, and submit order issues,
through `/api/v1/orders`. Order creation snapshots prices and shipping details
and updates stock within the same transaction.

Staff can create counter memos, collect payments, and retrieve invoice data
through `/api/v1/counter-orders`. Counter orders share the order and stock
movement records with online orders.

Staff manage online and counter orders, track lifecycle changes, assign
couriers and staff, collect payments, and review customer issues through
`/api/v1/admin/orders` and `/api/v1/admin/order-issues`. Courier records are
managed under `/api/v1/couriers`; order exports are available as UTF-8 CSV.

Readers can manage their wishlist at `/api/v1/wishlist`, submit verified
purchase reviews at `/api/v1/reviews`, and view their review status and counts.
Approved book reviews and their rating summary are public under
`/api/v1/store/books/:bookId/reviews`. Moderators manage review reports and
approvals under `/api/v1/reviews/moderation`; authors can view approved reviews
for their books at `/api/v1/reviews/author`.

Approved authors who have accepted the publishing terms can submit manuscripts
and respond to revision requests under `/api/v1/manuscripts/me`. Staff can
review and assign manuscripts, exchange feedback, and convert approved
manuscripts into draft books through `/api/v1/manuscripts`.

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

## Final setup and operations

### Environment

Copy `.env.example` to `.env` and set the required values:

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | HTTP port; defaults to `3000` |
| `FRONTEND_URL` | Yes | The single allowed credentialed CORS origin |
| `ACCESS_TOKEN_SECRET` | Yes | Secret used to sign access JWTs |
| `ACCESS_TOKEN_EXPIRES` | No | Access-token lifetime; defaults to `15m` |
| `REFRESH_TOKEN_SECRET` | Yes | Secret used to sign refresh JWTs |
| `REFRESH_TOKEN_EXPIRES` | No | Refresh-token lifetime; defaults to `7d` |
| `UPLOAD_DIR` | No | Local upload directory; defaults to `./uploads` |
| `MAIL_FROM` | Yes | Sender label/address for outgoing mail |
| `SEED_ADMIN_EMAIL` | Seed | Email for the idempotent Super Admin seed |
| `SEED_ADMIN_PASSWORD` | Seed | Seed password; minimum 12 characters |
| `NODE_ENV` | No | Swagger is disabled when set to `production` |

Use distinct, randomly generated token secrets and do not commit `.env`.

### Database and seed

After configuring PostgreSQL and the environment:

```powershell
npm install
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

For local schema development, use `npx prisma migrate dev --name <change>`.
The seed command creates or updates the Super Admin, nine categories, two
publishers, default settings, and a courier. Set both seed variables before
running it. The seed does not create sample orders or books.

Swagger is available at `/api/docs` outside production. The API base path is
`/api/v1`; the Postman collection is [docs/postman.json](./docs/postman.json).
Requests are logged as structured JSON fields (method, path, status, duration);
query strings, headers, and request bodies are intentionally excluded.

### Module endpoint reference

All endpoints below are relative to `/api/v1`. Unless marked **Public**, routes
require a bearer token. Role names are `SUPER_ADMIN`, `ADMIN`, `MODERATOR`,
`WORKER`, `AUTHOR`, and `USER`.

| Module | Endpoints (method + path) | Access |
| --- | --- | --- |
| Health | `GET /health` | Public |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password`; `GET /auth/verify-email` | Public |
| Uploads | `POST /uploads/image`, `/uploads/pdf`, `/uploads/manuscript` | Any authenticated user |
| Users | `GET`, `PATCH /users/me`; `GET /users`, `/users/:id`, `/users/summary`; `POST /users`; `PATCH /users/:id` | Own profile; admin management; role changes Super Admin only |
| Addresses | `GET`, `POST /addresses`; `PATCH`, `DELETE /addresses/:id` | Authenticated owner |
| Authors | `POST /author-applications`; `GET`, `PATCH /authors/me`; `GET /authors`, `/authors/summary`, `/public/authors/:id` | User application; Author profile; staff/admin directory; approved public profiles |
| Publishers | `GET /publishers`, `/publishers/:id`, `/publishers/:id/books`; `POST`, `PATCH`, `DELETE /publishers` | Staff read; Admin write |
| Categories | `GET /categories`; `POST`, `PATCH`, `DELETE /categories/:id` | Public tree; staff management |
| Books | `GET /books`, `/books/:id`, `/books/history`, `/books/mine`, `/store/books`, `/store/books/:slug`; `POST /books`; `PATCH /books/:id`, `/books/:id/status`; `DELETE /books/:id` | Staff; Author-owned books; store routes public |
| Stock | `GET /stock`, `/stock/summary`, `/stock/history`, `/stock/alerts`, `/stock/export.csv`; `POST /stock/:bookId/movements`; `PATCH /stock/:bookId/alert-limit` | Staff |
| Shops | `GET /shops`, `/shops/summary`, `/shops/options`, `/shops/:id`; `POST /shops`; `PATCH`, `DELETE /shops/:id` | Staff read/write; Admin delete |
| Online orders | `POST /orders`, `/orders/me/:id/cancel`, `/orders/me/:id/issues`; `GET /orders/me`, `/orders/me/:id`, `/orders/me/:id/track`, `/orders/me/issues` | User |
| Counter orders | `POST /counter-orders`, `/counter-orders/:id/payments`; `GET /counter-orders`, `/counter-orders/:id` | Staff |
| Order management | `GET /admin/orders`, `/admin/orders/stats`, `/admin/orders/:id`, `/admin/orders/export.csv`, `/admin/order-issues`, `/couriers`; `PATCH /admin/orders/:id/status`, `/admin/orders/:id/courier`, `/admin/orders/:id/assign`, `/admin/order-issues/:id`; `POST`, `PATCH /couriers` | Staff |
| Wishlist | `GET`, `POST /wishlist`, `DELETE /wishlist/:bookId` | User |
| Reviews | `POST /reviews`, `/reviews/:id/report`; `GET /reviews/me`, `/reviews/moderation`, `/reviews/author`, `/store/books/:bookId/reviews`; `PATCH`, `DELETE /reviews/:id` | User, moderation roles, Author; public book reviews |
| Manuscripts | `POST /manuscripts`, `/manuscripts/:id/feedback`, `/manuscripts/:id/convert-to-book`; `GET /manuscripts/me`, `/manuscripts`, `/manuscripts/:id`; `PATCH /manuscripts/:id/status`, `/manuscripts/:id/assign` | Author; staff; Admin convert |
| Royalties & payouts | `GET /author/analytics`, `/author/analytics/monthly`, `/author/analytics/books`, `/payouts/me`, `/payouts`; `POST /payouts`, `/payouts/:id/cancel`; `PATCH /payouts/:id` | Author; Admin payout management |
| Costs | `GET /costs`, `/costs/summary`, `/costs/books`, `/costs/export.csv`; `POST /costs/book`, `/costs/salary`, `/costs/marketing`; `PATCH`, `DELETE /costs/:id` | Admin |
| Messages | `POST /contact`; `GET /messages`, `/messages/:id`; `PATCH /messages/:id/status`; `POST /messages/:id/reply` | Public contact; staff inbox |
| Magazines | `POST /magazines`; `GET /magazines`, `/magazines/me`, `/magazines/:id`; `PATCH /magazines/:id`, `/magazines/:id/review`; `DELETE /magazines/:id` | User submission; staff review; published public reads |
| Settings | `GET /settings/public`, `/settings/:key`; `PUT /settings/:key` | Public settings; Admin; secrets Super Admin only |
| Dashboard | `GET /dashboard` | Role-specific authenticated data |
| Reports | `GET /reports/sales`, `/reports/top-books`, `/reports/stock-valuation`, `/reports/author-royalties`, `/reports/costs` and `.csv` variants | Admin |

### Documented business assumptions

- **ASSUMPTION — Counter commission:** a shop's commission is subtracted from
  the order subtotal as a discount to calculate the shop's payable total.
- **ASSUMPTION — Dashboard profit:** monthly profit is completed/paid order
  revenue less the month's recorded `CostEntry` total.
- Delivery-charge defaults are 60 inside Dhaka and 120 outside Dhaka; the
  `delivery_charges` setting overrides these values.
- A payout's available balance is earned royalties minus pending, approved, and
  paid payout requests.

### Verification

```powershell
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

The Supertest E2E suite uses isolated mocked providers by default; service unit
tests cover the business rules. For database integration validation, configure
a disposable PostgreSQL test database and apply migrations to that database
only.

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
