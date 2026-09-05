import { config } from "dotenv";

import type { RecordedQuote } from "./recorded-data";

config({ path: ".env.local" });

const symbols = [
  { appSymbol: "AAPL", providerSymbol: "AAPL" },
  { appSymbol: "MSFT", providerSymbol: "MSFT" },
  { appSymbol: "GOOGL", providerSymbol: "GOOGL" },
  { appSymbol: "RELIANCE.NS", providerSymbol: "RELIANCE:NSE" },
];

type TwelveDataQuote = {
  symbol?: string;
  name?: string;
  exchange?: string;
  close?: string;
  previous_close?: string;
  volume?: string;
  datetime?: string;
  timestamp?: string;
  status?: string;
  message?: string;
};

export type LiveQuote = RecordedQuote & { observedAt: Date };

export async function getLiveQuotes(): Promise<LiveQuote[]> {
  const key = process.env.MARKET_DATA_API_KEY;
  if (!key) throw new Error("MARKET_DATA_API_KEY is not set");

  const url = new URL("https://api.twelvedata.com/quote");
  url.searchParams.set("symbol", symbols.map((symbol) => symbol.providerSymbol).join(","));
  url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Twelve Data request failed (${response.status})`);
  const payload = (await response.json()) as Record<string, TwelveDataQuote> & TwelveDataQuote;
  if (payload.status === "error" || payload.message) throw new Error(payload.message ?? "Twelve Data returned an error");

  return symbols.map(({ appSymbol, providerSymbol }) => {
    const quote = payload[providerSymbol] ?? payload[appSymbol];
    const requestedSymbol = appSymbol;
    if (!quote?.close || !quote.previous_close) throw new Error(`Twelve Data returned no usable quote for ${requestedSymbol}`);
    const price = Number(quote.close);
    const previous = Number(quote.previous_close);
    if (!Number.isFinite(price) || !Number.isFinite(previous)) throw new Error(`Invalid quote for ${requestedSymbol}`);
    const observedAt = quote.timestamp
      ? new Date(Number(quote.timestamp) * 1000)
      : new Date(`${quote.datetime}Z`);
    return {
      symbol: requestedSymbol,
      exchange: quote.exchange ?? (requestedSymbol.endsWith(".NS") ? "NSE" : "NASDAQ"),
      name: quote.name ?? requestedSymbol,
      sector: "Equity",
      priceMinorUnits: Math.round(price * 100),
      previousPriceMinorUnits: Math.round(previous * 100),
      volume: Number(quote.volume ?? 0) || 0,
      typicalVolume: Math.max(Number(quote.volume ?? 0) || 0, 1),
      volatilityBps: Math.max(Math.abs((price - previous) / previous) * 10000, 1),
      observedAt,
    };
  });
}
