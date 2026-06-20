import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = (process.env["ALLOWED_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Matches both *.replit.dev (dev previews) and *.replit.app (production deploys).
// Only used in development — in production every origin must be in ALLOWED_ORIGINS.
const REPLIT_DOMAIN_RE = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.replit\.(dev|app)(:\d+)?$/i;
const isDev = process.env["NODE_ENV"] !== "production";

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0 && isDev) return cb(null, true);
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      if (isDev && REPLIT_DOMAIN_RE.test(origin)) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Store-Slug"],
    exposedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  const erpDist = path.resolve(__dirname, "../../erp/dist/public");
  app.use("/erp", express.static(erpDist));
  app.use("/erp", (req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(erpDist, "index.html"));
  });

  const webStoreDist = path.resolve(__dirname, "../../web-store/dist/public");
  app.use(express.static(webStoreDist));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(webStoreDist, "index.html"));
  });
}

export default app;
