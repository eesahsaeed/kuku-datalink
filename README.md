# Vite React Express Boilerplate

> Quickly bootstrap a new project with Vite React Express Boilerplate.

This boilerplate is a fork of [lmachens/vite-boilerplate](https://github.com/lmachens/vite-boilerplate), but replaces TypeScript with JavaScript and removes Storybook.

This boilerplate contains all the tools you need to build a modern web app with JavaScript, React, Vite, and Express.  
You can use it to quickly bootstrap your project.

ESLint, stylelint, prettier, husky and lintstaged are configured to give you a solid development experience.

## Installing / Developing

First, [create a repository from this template](https://docs.github.com/en/github/creating-cloning-and-archiving-repositories/creating-a-repository-on-github/creating-a-repository-from-a-template).

Now you are ready to go:

```shell
npm install
```

This will install the dependencies required to run the boilerplate.

```shell
npm run dev
```

Boom! These scripts run your server and client in development mode.

The default PORTS are:

- `3001` for the server
- `3000` for the client

If you don't like to call all scripts at once, you can also run:

```shell
npm run server:dev
npm run client:dev
```

You can configure the server port by setting the `PORT` environment variable. Creating a `.env` file is supported. You can copy `.env.example` to `.env`.

| KEY  | VALUE                                                                                |
| ---- | ------------------------------------------------------------------------------------ |
| PORT | (Optional) Port for the server environment (defaults to 3001 in dev, 3000 otherwise) |

## Building

To build the project, run:

```shell
npm run build
```

This will build the client and server.

```shell
npm start
```

In production, you have a single server serving everything.

`/api/*` is the API endpoint.  
`/*` is the client.

## Northflank Deployment

This repository includes a production-ready `Dockerfile` for Northflank combined services.

### Create the service

1. Create a **combined service** in Northflank.
2. Select this repository and branch.
3. Set build type to **Dockerfile**.
4. Keep Dockerfile path as `/Dockerfile`.
5. Expose port `3000` as a public HTTP port (Northflank can auto-detect this from `EXPOSE 3000`).
6. Set health check path to `/healthz` (HTTP) so Northflank can verify the container is listening even while DB reconnects.

### Required runtime environment variables

Set these in your Northflank service (or attach a secret group):

- `NODE_ENV=production`
- `PORT=3000`
- `MONGO_URI`
- `JWT_SECRET`
- `FRONTEND_URL`
- `BACKEND_URL`

You should also set any payment/support mail credentials used by your deployment, for example:

- `PAYSTACK_*`
- `AIDAPAY_*`
- `SUPPORT_EMAIL`
- `SUPPORT_PASSWORD`
- `NOREPLY_EMAIL`
- `NOREPLY_PASSWORD`

## Tests

A test runner is not installed (right now). But ESLint and Prettier are checked on commit and pushed thanks to husky and lintstaged.

## Adsterra readiness

The customer app is wired for Adsterra via env toggles.

1. Copy `.env.example` to `.env`.
2. Set:
   - `VITE_ADSTERRA_ENABLED=true`
   - Optional overrides for ad zones:
   - `VITE_ADSTERRA_IFRAME_SCRIPT_URL=...`
   - `VITE_ADSTERRA_CONTAINER_SCRIPT_URL=...`
   - `VITE_ADSTERRA_DIRECT_LINK_URL=...` (optional)
3. `ads.txt` and `app-ads.txt` templates are provided in `public/`. Replace placeholders with your real publisher IDs.

## Licensing

MIT
