import {
  bigint,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const freshnessEnum = pgEnum("freshness", ["live", "delayed", "stale", "closed"]);

export const significanceEventTypeEnum = pgEnum("significance_event_type", [
  "relative_move",
  "volume_anomaly",
  "threshold_crossed",
  "corporate_action",
  "unexplained_move",
]);

export const instrument = pgTable(
  "instrument",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: varchar("symbol", { length: 32 }).notNull(),
    exchange: varchar("exchange", { length: 32 }).notNull(),
    name: text("name").notNull(),
    sector: varchar("sector", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    exchangeSymbolUnique: unique("instrument_exchange_symbol_unique").on(table.exchange, table.symbol),
  }),
);

export const watchlist = pgTable("watchlist", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const watchlistItem = pgTable(
  "watchlist_item",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlist.id, { onDelete: "cascade" }),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrument.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    priceThreshold: numeric("price_threshold", { precision: 20, scale: 8 }),
  },
  (table) => ({
    watchlistInstrumentUnique: unique("watchlist_item_watchlist_instrument_unique").on(
      table.watchlistId,
      table.instrumentId,
    ),
  }),
);

export const priceSnapshot = pgTable(
  "price_snapshot",
  {
    id: serial("id").primaryKey(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrument.id, { onDelete: "cascade" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    price: numeric("price", { precision: 20, scale: 8 }).notNull(),
    volume: bigint("volume", { mode: "number" }),
    source: varchar("source", { length: 64 }).notNull(),
    freshness: freshnessEnum("freshness").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    instrumentObservedAtIndex: index("price_snapshot_instrument_observed_at_idx").on(
      table.instrumentId,
      table.observedAt,
    ),
  }),
);

export const significanceEvent = pgTable(
  "significance_event",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrument.id, { onDelete: "cascade" }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    type: significanceEventTypeEnum("type").notNull(),
    magnitude: numeric("magnitude", { precision: 20, scale: 8 }).notNull(),
    explanation: text("explanation").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    instrumentDetectedAtIndex: index("significance_event_instrument_detected_at_idx").on(
      table.instrumentId,
      table.detectedAt,
    ),
  }),
);

export const userWatermark = pgTable("user_watermark", {
  userId: text("user_id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});