import { and, eq, gt, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { instrument, significanceEvent, userWatermark, watchlist, watchlistItem } from "@/db/schema";
import { applyAttentionCap, getUpcomingCalendarEvents, rankBriefEvents } from "@/lib/brief";
import { getUserId } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const db = getDb();
  const userId = getUserId(request);
  const now = new Date();
  const [savedWatermark] = await db
    .select({ lastSeenAt: userWatermark.lastSeenAt })
    .from(userWatermark)
    .where(eq(userWatermark.userId, userId));
  const lastSeenAt = savedWatermark?.lastSeenAt ?? new Date(0);

  const userInstruments = await db
    .selectDistinct({ instrumentId: watchlistItem.instrumentId, symbol: instrument.symbol })
    .from(watchlistItem)
    .innerJoin(watchlist, eq(watchlistItem.watchlistId, watchlist.id))
    .innerJoin(instrument, eq(watchlistItem.instrumentId, instrument.id))
    .where(eq(watchlist.userId, userId));
  const instrumentIds = userInstruments.map((row) => row.instrumentId);

  if (instrumentIds.length === 0) {
    return NextResponse.json({
      userId,
      watermark: { lastSeenAt: lastSeenAt.toISOString(), initialized: Boolean(savedWatermark) },
      surfaced: [],
      suppressedCount: 0,
      emptyState: "Nothing meaningful changed since you last checked.",
      forwardLooking: { source: "bundled-demo-calendar", events: [] },
    });
  }

  const eventRows = await db
    .select({
      id: significanceEvent.id,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      type: significanceEvent.type,
      magnitude: significanceEvent.magnitude,
      explanation: significanceEvent.explanation,
      confidence: significanceEvent.confidence,
      detectedAt: significanceEvent.detectedAt,
    })
    .from(significanceEvent)
    .innerJoin(instrument, eq(significanceEvent.instrumentId, instrument.id))
    .where(and(inArray(significanceEvent.instrumentId, instrumentIds), gt(significanceEvent.detectedAt, lastSeenAt)));

  const rankedEvents = rankBriefEvents(eventRows, now);
  const { surfaced, suppressedCount } = applyAttentionCap(rankedEvents);
  const forwardLooking = getUpcomingCalendarEvents(
    userInstruments.map((row) => row.symbol),
    now,
  );

  return NextResponse.json({
    userId,
    watermark: { lastSeenAt: lastSeenAt.toISOString(), initialized: Boolean(savedWatermark) },
    surfaced: surfaced.map((event) => ({ ...event, detectedAt: event.detectedAt.toISOString() })),
    suppressedCount,
    ...(surfaced.length === 0 ? { emptyState: "Nothing meaningful changed since you last checked." } : {}),
    forwardLooking: { source: "bundled-demo-calendar", events: forwardLooking },
  });
}