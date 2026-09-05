import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { instrument, watchlist, watchlistItem } from "@/db/schema";
import {
  getUserId,
  thresholdSchema,
  validationError,
  watchlistIdSchema,
  watchlistItemSchema,
} from "@/lib/watchlist";

type RouteContext = { params: Promise<{ watchlistId: string; instrumentId: string }> };

async function getOwnedList(request: Request, watchlistId: string) {
  const parsedId = watchlistIdSchema.safeParse(watchlistId);
  if (!parsedId.success) return null;

  return getDb().query.watchlist.findFirst({
    where: and(eq(watchlist.id, parsedId.data), eq(watchlist.userId, getUserId(request))),
    columns: { id: true },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { watchlistId, instrumentId } = await context.params;
  const body = watchlistItemSchema.safeParse({ instrumentId });
  if (!body.success) return validationError(body.error);

  const ownedList = await getOwnedList(request, watchlistId);
  if (!ownedList) return NextResponse.json({ error: "Watchlist not found" }, { status: 404 });

  const db = getDb();
  const [existingInstrument] = await db
    .select({ id: instrument.id })
    .from(instrument)
    .where(eq(instrument.id, body.data.instrumentId));
  if (!existingInstrument) return NextResponse.json({ error: "Instrument not found" }, { status: 404 });

  const [existingItem] = await db
    .select({ id: watchlistItem.id })
    .from(watchlistItem)
    .where(and(eq(watchlistItem.watchlistId, ownedList.id), eq(watchlistItem.instrumentId, body.data.instrumentId)));
  if (existingItem) return NextResponse.json({ error: "Instrument is already in this watchlist" }, { status: 409 });

  const [item] = await db
    .insert(watchlistItem)
    .values({ watchlistId: ownedList.id, instrumentId: body.data.instrumentId })
    .returning({ id: watchlistItem.id, instrumentId: watchlistItem.instrumentId, sortOrder: watchlistItem.sortOrder });
  await db.update(watchlist).set({ updatedAt: new Date() }).where(eq(watchlist.id, ownedList.id));

  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { watchlistId, instrumentId } = await context.params;
  const payload = thresholdSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) return validationError(payload.error);

  const ownedList = await getOwnedList(request, watchlistId);
  if (!ownedList) return NextResponse.json({ error: "Watchlist not found" }, { status: 404 });

  const [updated] = await getDb()
    .update(watchlistItem)
    .set({ priceThreshold: payload.data.priceThreshold?.toFixed(8) ?? null })
    .where(and(eq(watchlistItem.watchlistId, ownedList.id), eq(watchlistItem.instrumentId, instrumentId)))
    .returning({ id: watchlistItem.id, instrumentId: watchlistItem.instrumentId, priceThreshold: watchlistItem.priceThreshold });
  if (!updated) return NextResponse.json({ error: "Watchlist item not found" }, { status: 404 });

  await getDb().update(watchlist).set({ updatedAt: new Date() }).where(eq(watchlist.id, ownedList.id));
  return NextResponse.json({ item: { ...updated, priceThreshold: updated.priceThreshold === null ? null : Number(updated.priceThreshold) } });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { watchlistId, instrumentId } = await context.params;
  const ownedList = await getOwnedList(request, watchlistId);
  if (!ownedList) return NextResponse.json({ error: "Watchlist not found" }, { status: 404 });

  const [deleted] = await getDb()
    .delete(watchlistItem)
    .where(and(eq(watchlistItem.watchlistId, ownedList.id), eq(watchlistItem.instrumentId, instrumentId)))
    .returning({ id: watchlistItem.id });
  if (!deleted) return NextResponse.json({ error: "Watchlist item not found" }, { status: 404 });

  await getDb().update(watchlist).set({ updatedAt: new Date() }).where(eq(watchlist.id, ownedList.id));
  return new Response(null, { status: 204 });
}