import { Hono } from "hono";
import { cors } from "hono/cors";
import type { RelayEnv } from "./env.js";
import type { Store } from "./store.js";
import type { AdminAuth } from "./auth.js";
import { webhookHandler } from "./routes/webhook.js";
import { adminRouter } from "./routes/admin.js";

export interface Deps {
  env: RelayEnv;
  store: Store;
  auth: AdminAuth;
}

export function createApp(deps: Deps): Hono {
  const app = new Hono();

  // The admin API and health check are called cross-origin from the Lockform
  app.use(
    "*",
    cors({
      origin: (origin) =>
        deps.env.allowedOrigins.includes(origin) ? origin : null,
      allowMethods: ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      maxAge: 86400,
    }),
  );

  app.get("/", (c) => c.text("Lockform Relay is running. See /health."));
  app.get("/health", (c) =>
    c.json({ status: "ok", service: "lockform-relay", version: "0.1.0" }),
  );

  app.post("/webhook", webhookHandler(deps));
  app.route("/admin", adminRouter(deps));

  return app;
}
