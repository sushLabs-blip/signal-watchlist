export type BriefEvent = {
  id: string;
  symbol: string;
  exchange: string;
  type: string;
  magnitude: string;
  explanation: string;
  confidence: string;
  detectedAt: Date;
};

export type RankedBriefEvent = BriefEvent & { salience: number };

const eventWeights: Record<string, number> = {
  corporate_action: 1.35,
  threshold_crossed: 1.25,
  unexplained_move: 1.15,
  relative_move: 1,
  volume_anomaly: 0.85,
};

export function rankBriefEvents(events: BriefEvent[], now = new Date()): RankedBriefEvent[] {
  const seen = new Set<string>();

  return events
    .map((event) => {
      const ageDays = Math.max(0, now.getTime() - event.detectedAt.getTime()) / 86_400_000;
      const magnitude = Math.min(Math.abs(Number(event.magnitude)), 10);
      const confidence = Math.max(0, Math.min(Number(event.confidence), 1));
      const noveltyKey = `${event.symbol}:${event.type}`;
      const noveltyPenalty = seen.has(noveltyKey) ? 0.75 : 1;
      seen.add(noveltyKey);
      const salience =
        (eventWeights[event.type] ?? 0.75) *
        Math.max(magnitude, 0.1) *
        confidence *
        Math.exp(-ageDays / 3) *
        noveltyPenalty;

      return { ...event, salience };
    })
    .sort((left, right) => right.salience - left.salience);
}

export function applyAttentionCap(events: RankedBriefEvent[], cap = 5) {
  const eligible = events.filter((event) => event.salience >= 0.1);
  return {
    surfaced: eligible.slice(0, cap),
    suppressedCount: Math.max(0, eligible.length - cap) + events.length - eligible.length,
  };
}

export type CalendarEvent = {
  symbol: string;
  type: "earnings" | "investor_day" | "corporate_update";
  title: string;
  scheduledFor: string;
  historicalReaction: string;
  source: "bundled-demo-calendar";
};

const bundledCalendar: Array<Omit<CalendarEvent, "scheduledFor"> & { daysAhead: number }> = [
  {
    symbol: "SIGA",
    type: "earnings",
    title: "Quarterly earnings release",
    daysAhead: 2,
    historicalReaction: "Median one-day move after the last four releases: 3.1%.",
    source: "bundled-demo-calendar",
  },
  {
    symbol: "NOVA",
    type: "investor_day",
    title: "Investor day",
    daysAhead: 5,
    historicalReaction: "The last two investor days produced moves below 1%.",
    source: "bundled-demo-calendar",
  },
  {
    symbol: "LUMA",
    type: "earnings",
    title: "Quarterly earnings release",
    daysAhead: 3,
    historicalReaction: "Median reaction across recent releases: 2.4%.",
    source: "bundled-demo-calendar",
  },
  {
    symbol: "SIGA",
    type: "corporate_update",
    title: "Product update",
    daysAhead: 7,
    historicalReaction: "Prior updates produced a median one-day move of 1.8%.",
    source: "bundled-demo-calendar",
  },
];

export function getUpcomingCalendarEvents(symbols: string[], now = new Date()): CalendarEvent[] {
  const symbolSet = new Set(symbols);
  return bundledCalendar
    .filter((event) => symbolSet.has(event.symbol))
    .map((event) => ({
      ...event,
      scheduledFor: new Date(now.getTime() + event.daysAhead * 86_400_000).toISOString(),
    }));
}
