import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import * as pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  (pinoHttp as any).default({
    logger,
    serializers: {
      req(req: Request) {
        return {
          id: (req as any).id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: Response) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const frontendDist =
    process.env.FRONTEND_DIST_PATH ??
    path.resolve(process.cwd(), "artifacts/vivid-detailing/dist/public");

  app.use(express.static(frontendDist));

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
