import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { instrument, priceSnapshot, significanceEvent, watchlist, watchlistItem } from "@/db/schema";
import { rankBriefEvents } from "@/lib/brief";
import { createWatchlistSchema, getUserId, validationError } from "@/lib/watchlist";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const db = getDb();
  const userId = getUserId(request);
  const rows = await db
    .select({
      id: watchlist.id,
      name: watchlist.name,
      createdAt: watchlist.createdAt,
      updatedAt: watchlist.updatedAt,
      itemId: watchlistItem.id,
      sortOrder: watchlistItem.sortOrder,
      priceThreshold: watchlistItem.priceThreshold,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      instrumentName: instrument.name,
      sector: instrument.sector,
    })
    .from(watchlist)
    .leftJoin(watchlistItem, eq(watchlistItem.watchlistId, watchlist.id))
    .leftJoin(instrument, eq(watchlistItem.instrumentId, instrument.id))
    .where(eq(watchlist.userId, userId))
    .orderBy(asc(watchlist.createdAt), asc(watchlistItem.sortOrder));

  const lists = new Map<string, {
    id: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    items: Array<Record<string, unknown>>;
  }>();

  const instrumentIds = rows.flatMap((row) => (row.instrumentId ? [row.instrumentId] : []));
  const latestSnapshots = instrumentIds.length
    ? await db
        .select({
          instrumentId: priceSnapshot.instrumentId,
          price: priceSnapshot.price,
          observedAt: priceSnapshot.observedAt,
          freshness: priceSnapshot.freshness,
          source: priceSnapshot.source,
        })
        .from(priceSnapshot)
        .where(inArray(priceSnapshot.instrumentId, instrumentIds))
        .orderBy(desc(priceSnapshot.observedAt))
    : [];
  const snapshotsByInstrument = new Map<string, (typeof latestSnapshots)[number]>();
  for (const snapshot of latestSnapshots) {
    if (!snapshotsByInstrument.has(snapshot.instrumentId)) snapshotsByInstrument.set(snapshot.instrumentId, snapshot);
  }

  const recentEvents = instrumentIds.length
    ? await db
        .select({
          id: significanceEvent.id,
          symbol: instrument.symbol,
          exchange: instrument.exchange,
          type: significanceEvent.type,
          magnitude: significanceEvent.magnitude,
          explanation: significanceEvent.explanation,
          confidence: significanceEvent.confidence,
          detectedAt: significanceEvent.detectedAt,
          instrumentId: significanceEvent.instrumentId,
        })
        .from(significanceEvent)
        .innerJoin(instrument, eq(significanceEvent.instrumentId, instrument.id))
        .where(and(inArray(significanceEvent.instrumentId, instrumentIds), gte(significanceEvent.detectedAt, new Date(Date.now() - 7 * 86_400_000))))
        .orderBy(desc(significanceEvent.detectedAt))
    : [];
  const eventsByInstrument = new Map<string, typeof recentEvents>();
  for (const event of recentEvents) {
    const events = eventsByInstrument.get(event.instrumentId) ?? [];
    events.push(event);
    eventsByInstrument.set(event.instrumentId, events);
  }

  for (const row of rows) {
    const list = lists.get(row.id) ?? {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items: [],
    };
    if (row.itemId && row.instrumentId && row.symbol && row.exchange && row.instrumentName) {
      const snapshot = snapshotsByInstrument.get(row.instrumentId);
      const rankedEvents = rankBriefEvents(eventsByInstrument.get(row.instrumentId) ?? []);
      const topEvent = rankedEvents[0];
      list.items.push({
        id: row.itemId,
        sortOrder: row.sortOrder,
        priceThreshold: row.priceThreshold === null ? null : Number(row.priceThreshold),
        latestPrice: snapshot?.price === undefined ? null : Number(snapshot.price),
        priceObservedAt: snapshot?.observedAt?.toISOString() ?? null,
        freshness: snapshot?.freshness ?? "stale",
        source: snapshot?.source ?? null,
        significanceScore: topEvent?.salience ?? 0,
        latestSignificance: topEvent
          ? { type: topEvent.type, explanation: topEvent.explanation, detectedAt: topEvent.detectedAt.toISOString() }
          : null,
        instrument: {
          id: row.instrumentId,
          symbol: row.symbol,
          exchange: row.exchange,
          name: row.instrumentName,
          sector: row.sector,
        },
      });
    }
    lists.set(row.id, list);
  }

  return NextResponse.json({ userId, watchlists: Array.from(lists.values()) });
}

export async function POST(request: Request) {
  const payload = createWatchlistSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return validationError(payload.error);

  const db = getDb();
  const now = new Date();
  const [created] = await db
    .insert(watchlist)
    .values({ userId: getUserId(request), name: payload.data.name, createdAt: now, updatedAt: now })
    .returning({ id: watchlist.id, name: watchlist.name, createdAt: watchlist.createdAt, updatedAt: watchlist.updatedAt });

  return NextResponse.json({ watchlist: { ...created, items: [] } }, { status: 201 });
}