import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { instrument, priceSnapshot, significanceEvent, watchlistItem } from "@/db/schema";
import { getRecordedQuotes } from "@/lib/ingest/recorded-data";
import { detectSignificance, normalizeQuote } from "@/lib/ingest/logic";

export const dynamic = "force-dynamic";

export async function GET() {
  return ingest();
}

export async function POST() {
  return ingest();
}

async function ingest() {
  const db = getDb();
  const receivedAt = new Date();
  const source: "live" | "recorded" = "recorded";
  const quotes = getRecordedQuotes();
  let snapshotsWritten = 0;
  let eventsWritten = 0;

  for (const rawQuote of quotes) {
    const observedAt = rawQuote.observedAt ?? receivedAt;
    const quote = normalizeQuote(rawQuote, receivedAt, {
      source,
      observedAt,
    });
    const [savedInstrument] = await db
      .insert(instrument)
      .values({
        symbol: quote.symbol,
        exchange: quote.exchange,
        name: quote.name,
        sector: quote.sector,
      })
      .onConflictDoNothing({ target: [instrument.exchange, instrument.symbol] })
      .returning({ id: instrument.id });

    const existingInstrument =
      savedInstrument ??
      (await db.query.instrument.findFirst({
        where: and(eq(instrument.exchange, quote.exchange), eq(instrument.symbol, quote.symbol)),
        columns: { id: true },
      }));

    if (!existingInstrument) {
      throw new Error(`Could not resolve instrument ${quote.exchange}:${quote.symbol}`);
    }

    const existingSnapshot = await db.query.priceSnapshot.findFirst({
      where: and(eq(priceSnapshot.instrumentId, existingInstrument.id), eq(priceSnapshot.observedAt, quote.observedAt)),
      columns: { id: true },
    });
    if (!existingSnapshot) {
      await db.insert(priceSnapshot).values({
        instrumentId: existingInstrument.id,
        observedAt: quote.observedAt,
        price: (quote.priceMinorUnits / 100).toFixed(2),
        volume: quote.volume,
        source: quote.source,
        freshness: quote.freshness,
      });
      snapshotsWritten += 1;
    }

    const thresholds = await db
      .select({ priceThreshold: watchlistItem.priceThreshold })
      .from(watchlistItem)
      .where(eq(watchlistItem.instrumentId, existingInstrument.id));
    const detectedEvents = detectSignificance(
      quote,
      thresholds.flatMap((row) => (row.priceThreshold ? [row.priceThreshold] : [])),
    );
    const recentCutoff = new Date(receivedAt.getTime() - 60 * 60 * 1000);

    for (const event of detectedEvents) {
      const existingEvent = await db.query.significanceEvent.findFirst({
        where: and(
          eq(significanceEvent.instrumentId, existingInstrument.id),
          eq(significanceEvent.type, event.type),
          gte(significanceEvent.detectedAt, recentCutoff),
        ),
        orderBy: [desc(significanceEvent.detectedAt)],
        columns: { id: true },
      });

      if (!existingEvent) {
        await db.insert(significanceEvent).values({
          instrumentId: existingInstrument.id,
          detectedAt: receivedAt,
          type: event.type,
          magnitude: event.magnitude,
          explanation: event.explanation,
          confidence: event.confidence,
        });
        eventsWritten += 1;
      }
    }
  }

  return NextResponse.json({
    source,
    processedAt: receivedAt.toISOString(),
    snapshotsWritten,
    eventsWritten,
  });
}
