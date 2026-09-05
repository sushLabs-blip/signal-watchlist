import { z } from "zod";

export const createWatchlistSchema = z.object({
  name: z.string().trim().min(1).max(128),
});

export const watchlistIdSchema = z.string().uuid();

export const watchlistItemSchema = z.object({
  instrumentId: z.string().uuid(),
});

export const thresholdSchema = z.object({
  priceThreshold: z.number().finite().nonnegative().nullable(),
});

export const acknowledgeSchema = z.object({
  eventId: z.string().uuid(),
  engagement: z.enum(["acknowledged", "expanded", "dwell"]).default("acknowledged"),
});

export function getUserId(request: Request) {
  const requestedUserId = request.headers.get("x-user-id")?.trim();
  return requestedUserId || "demo-user";
}

export function validationError(error: z.ZodError) {
  return Response.json(
    {
      error: "Invalid request",
      details: error.flatten(),
    },
    { status: 400 },
  );
}