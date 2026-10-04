import type { FastifyReply, FastifyRequest } from "fastify";
import { ErrorResponseSchema, type ErrorResponse } from "@moviewatch/contracts";

export function sendError(
  reply: FastifyReply,
  status: number,
  title: string,
  type = "about:blank",
  detail?: string,
) {
  const body: ErrorResponse = ErrorResponseSchema.parse({ type, title, status, detail });
  return reply.status(status).send(body);
}

export function notFound(request: FastifyRequest, reply: FastifyReply) {
  return sendError(reply, 404, "Not found", undefined, `No route for ${request.method} ${request.url}`);
}
