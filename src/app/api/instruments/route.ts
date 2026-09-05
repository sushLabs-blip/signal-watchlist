import { and, ilike, or } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { instrument } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ instruments: [] });
  const rows = await getDb().select({ id: instrument.id, symbol: instrument.symbol, name: instrument.name, exchange: instrument.exchange, sector: instrument.sector })
    .from(instrument)
    .where(or(ilike(instrument.symbol, `%${query}%`), ilike(instrument.name, `%${query}%`)))
    .limit(10);
  return NextResponse.json({ instruments: rows });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { symbol?: string; name?: string; exchange?: string } | null;
  const symbol = body?.symbol?.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9.-]{1,32}$/.test(symbol)) return NextResponse.json({ error: "Enter a valid symbol." }, { status: 400 });
  const db = getDb();
  const existing = await db.query.instrument.findFirst({ where: ilike(instrument.symbol, symbol), columns: { id: true, symbol: true, name: true, exchange: true, sector: true } });
  if (existing) return NextResponse.json({ instrument: existing });
  const [created] = await db.insert(instrument).values({ symbol, name: body?.name?.trim() || symbol, exchange: body?.exchange?.trim() || "DEMO", sector: "Equity" }).returning({ id: instrument.id, symbol: instrument.symbol, name: instrument.name, exchange: instrument.exchange, sector: instrument.sector });
  return NextResponse.json({ instrument: created }, { status: 201 });
}
