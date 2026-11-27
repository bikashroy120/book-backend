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
