import type { FastifyInstance } from "fastify";
import { HealthResponseSchema } from "@moviewatch/contracts";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return HealthResponseSchema.parse({
      status: "ok",
      service: "orchestrator-api",
      version: "0.1.0",
      time: new Date().toISOString(),
    });
  });
}
