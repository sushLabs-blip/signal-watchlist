export type RecordedQuote = {
  symbol: string; exchange: string; name: string; sector: string;
  priceMinorUnits: number; previousPriceMinorUnits: number; volume: number;
  typicalVolume: number; volatilityBps: number; observedAt?: Date;
};

type Definition = Omit<RecordedQuote, "priceMinorUnits" | "previousPriceMinorUnits" | "volume" | "observedAt" | "typicalVolume" | "volatilityBps"> & { prices: number[]; volumes: number[] };

const definitions: Definition[] = [
  { symbol: "SIGA", exchange: "NASDAQ", name: "Signal Analytics", sector: "Technology", prices: [11.8,12.1,11.9,12.4,12.7,12.5,12.9,13.2,14.8,14.4,14.1,14.6,15.1,14.9], volumes: [310,290,330,360,410,380,430,470,1250,720,510,480,560,530] },
  { symbol: "NOVA", exchange: "NYSE", name: "Nova Systems", sector: "Industrials", prices: [77.5,76.9,77.2,76.4,75.8,76.1,75.4,74.9,72.8,73.5,74.2,73.8,75.1,75.6], volumes: [205,220,210,245,260,230,280,310,980,420,390,360,410,385] },
  { symbol: "LUMA", exchange: "NYSE", name: "Luma Health", sector: "Healthcare", prices: [43.2,44.1,43.8,44.7,45.3,44.9,46.1,47.2,46.5,48.0,47.4,46.8,45.9,47.1], volumes: [280,300,265,340,360,315,390,460,420,1100,620,510,470,530] },
  { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc.", sector: "Technology", prices: [218.4,219.1,217.8,220.2,221.5,220.7,223.4,225.1,229.8,227.2,226.4,228.9,231.2,230.4], volumes: [900,850,920,980,1100,1050,1200,1300,3200,1700,1400,1350,1500,1450] },
  { symbol: "MSFT", exchange: "NASDAQ", name: "Microsoft Corp.", sector: "Technology", prices: [412.2,410.8,413.6,415.1,414.2,417.8,419.4,418.7,426.9,424.5,423.1,425.8,428.2,427.6], volumes: [700,680,740,760,820,850,900,940,2500,1300,1100,1050,1200,1150] },
  { symbol: "GOOGL", exchange: "NASDAQ", name: "Alphabet Inc.", sector: "Technology", prices: [175.2,176.1,174.8,177.4,178.0,177.2,179.5,181.3,187.6,185.4,184.9,186.2,188.1,187.5], volumes: [600,580,640,680,720,700,760,820,2300,1200,980,950,1100,1050] },
];

const recordedQuotes: RecordedQuote[] = definitions.flatMap((definition) => definition.prices.map((price, index) => ({
  symbol: definition.symbol, exchange: definition.exchange, name: definition.name, sector: definition.sector,
  priceMinorUnits: Math.round(price * 100), previousPriceMinorUnits: Math.round((definition.prices[index - 1] ?? price) * 100),
  volume: definition.volumes[index] * 1000, typicalVolume: 350000, volatilityBps: 180,
  observedAt: new Date(Date.UTC(2026, 7, 3 + index, 14, 30)),
})));

export function getRecordedQuotes(): RecordedQuote[] { return recordedQuotes; }
