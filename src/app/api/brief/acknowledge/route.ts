import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { significanceEvent, userWatermark, watchlist, watchlistItem } from "@/db/schema";
import { acknowledgeSchema, getUserId, validationError } from "@/lib/watchlist";

export async function POST(request: Request) {
  const payload = acknowledgeSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return validationError(payload.error);

  const db = getDb();
  const userId = getUserId(request);
  const [event] = await db
    .select({ detectedAt: significanceEvent.detectedAt })
    .from(significanceEvent)
    .innerJoin(watchlistItem, eq(watchlistItem.instrumentId, significanceEvent.instrumentId))
    .innerJoin(watchlist, eq(watchlist.id, watchlistItem.watchlistId))
    .where(and(eq(significanceEvent.id, payload.data.eventId), eq(watchlist.userId, userId)))
    .limit(1);

  if (!event) return NextResponse.json({ error: "Brief event not found" }, { status: 404 });

  const [current] = await db
    .select({ lastSeenAt: userWatermark.lastSeenAt })
    .from(userWatermark)
    .where(eq(userWatermark.userId, userId));
  const lastSeenAt = current && current.lastSeenAt > event.detectedAt ? current.lastSeenAt : event.detectedAt;

  await db
    .insert(userWatermark)
    .values({ userId, lastSeenAt })
    .onConflictDoUpdate({
      target: userWatermark.userId,
      set: { lastSeenAt },
    });

  return NextResponse.json({
    acknowledged: payload.data.eventId,
    engagement: payload.data.engagement,
    watermark: { lastSeenAt: lastSeenAt.toISOString() },
  });
}