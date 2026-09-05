import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { instrument, priceSnapshot, significanceEvent, userWatermark, watchlist, watchlistItem } from "@/db/schema";
import { getUserId } from "@/lib/watchlist";

type RouteContext = { params: Promise<{ instrumentId: string }> };

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: RouteContext) {
  const { instrumentId } = await context.params;
  const db = getDb();
  const userId = getUserId(request);
  const [ownedInstrument] = await db
    .select({ id: instrument.id, symbol: instrument.symbol, exchange: instrument.exchange, name: instrument.name, sector: instrument.sector })
    .from(instrument)
    .innerJoin(watchlistItem, eq(watchlistItem.instrumentId, instrument.id))
    .innerJoin(watchlist, eq(watchlist.id, watchlistItem.watchlistId))
    .where(and(eq(instrument.id, instrumentId), eq(watchlist.userId, userId)))
    .limit(1);

  if (!ownedInstrument) return NextResponse.json({ error: "Instrument not found" }, { status: 404 });

  const [savedWatermark] = await db
    .select({ lastSeenAt: userWatermark.lastSeenAt })
    .from(userWatermark)
    .where(eq(userWatermark.userId, userId));
  const snapshots = await db
    .select({ id: priceSnapshot.id, price: priceSnapshot.price, volume: priceSnapshot.volume, observedAt: priceSnapshot.observedAt, freshness: priceSnapshot.freshness, source: priceSnapshot.source })
    .from(priceSnapshot)
    .where(eq(priceSnapshot.instrumentId, instrumentId))
    .orderBy(asc(priceSnapshot.observedAt));
  const events = await db
    .select({ id: significanceEvent.id, type: significanceEvent.type, magnitude: significanceEvent.magnitude, explanation: significanceEvent.explanation, confidence: significanceEvent.confidence, detectedAt: significanceEvent.detectedAt })
    .from(significanceEvent)
    .where(eq(significanceEvent.instrumentId, instrumentId))
    .orderBy(asc(significanceEvent.detectedAt));

  return NextResponse.json({
    instrument: ownedInstrument,
    watermark: savedWatermark?.lastSeenAt.toISOString() ?? new Date(0).toISOString(),
    snapshots: snapshots.map((snapshot) => ({ ...snapshot, price: Number(snapshot.price), observedAt: snapshot.observedAt.toISOString() })),
    events: events.map((event) => ({ ...event, magnitude: Number(event.magnitude), confidence: Number(event.confidence), detectedAt: event.detectedAt.toISOString() })),
  });
}