import type { RecordedQuote } from "./recorded-data";

export type Freshness = "live" | "delayed" | "stale" | "closed";

export type NormalizedQuote = RecordedQuote & {
  observedAt: Date;
  source: string;
  freshness: Freshness;
};

export type DetectedEvent = {
  type: "relative_move" | "volume_anomaly" | "threshold_crossed" | "unexplained_move";
  magnitude: string;
  explanation: string;
  confidence: string;
};

export function classifyFreshness(ageSeconds: number): Freshness {
  if (ageSeconds <= 60) return "live";
  if (ageSeconds <= 900) return "delayed";
  if (ageSeconds <= 3600) return "stale";
  return "closed";
}

export function normalizeQuote(
  quote: RecordedQuote,
  receivedAt = new Date(),
  options: { source?: string; observedAt?: Date } = {},
): NormalizedQuote {
  if (!Number.isInteger(quote.priceMinorUnits) || quote.priceMinorUnits <= 0) {
    throw new Error(`Invalid price for ${quote.symbol}`);
  }

  if (quote.volume < 0 || quote.typicalVolume <= 0 || quote.volatilityBps <= 0) {
    throw new Error(`Invalid market data for ${quote.symbol}`);
  }

  return {
    ...quote,
    observedAt: options.observedAt ?? receivedAt,
    source: options.source ?? "recorded",
    freshness: options.source === "live"
      ? classifyFreshness(Math.max(0, (receivedAt.getTime() - (options.observedAt ?? receivedAt).getTime()) / 1000))
      : "closed",
  };
}

export function detectSignificance(
  quote: NormalizedQuote,
  thresholdValues: string[],
): DetectedEvent[] {
  const moveBps = ((quote.priceMinorUnits - quote.previousPriceMinorUnits) * 10000) / quote.previousPriceMinorUnits;
  const volumeRatio = quote.volume / quote.typicalVolume;
  const events: DetectedEvent[] = [];
  const unusualMove = Math.abs(moveBps) >= quote.volatilityBps * 2;
  const unusualVolume = volumeRatio >= 1.75;

  if (unusualMove && unusualVolume) {
    return [
      {
        type: "unexplained_move",
        magnitude: (moveBps / 10000).toFixed(8),
        explanation: `Unexplained move on unusually high volume for ${quote.symbol}.`,
        confidence: "0.7500",
      },
    ];
  }

  if (unusualMove) {
    events.push({
      type: "relative_move",
      magnitude: (moveBps / 10000).toFixed(8),
      explanation: `Move of ${(moveBps / 100).toFixed(2)}% is unusual for ${quote.symbol}'s normal volatility.`,
      confidence: Math.min(Math.abs(moveBps) / (quote.volatilityBps * 4), 1).toFixed(4),
    });
  }

  if (unusualVolume) {
    events.push({
      type: "volume_anomaly",
      magnitude: volumeRatio.toFixed(8),
      explanation: `Volume is ${volumeRatio.toFixed(1)}x the typical level for ${quote.symbol}.`,
      confidence: Math.min(volumeRatio / 3, 1).toFixed(4),
    });
  }

  for (const thresholdValue of thresholdValues) {
    const thresholdMinorUnits = Math.round(Number(thresholdValue) * 100);
    const crossed =
      (quote.previousPriceMinorUnits < thresholdMinorUnits && quote.priceMinorUnits >= thresholdMinorUnits) ||
      (quote.previousPriceMinorUnits > thresholdMinorUnits && quote.priceMinorUnits <= thresholdMinorUnits);

    if (crossed) {
      events.push({
        type: "threshold_crossed",
        magnitude: (quote.priceMinorUnits / 100).toFixed(8),
        explanation: `${quote.symbol} crossed your ${Number(thresholdValue).toFixed(2)} price threshold.`,
        confidence: "1.0000",
      });
    }
  }

  return events;
}
