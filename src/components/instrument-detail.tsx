"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import PriceChart from "@/components/price-chart";

type DetailData = {
  instrument: { id: string; symbol: string; exchange: string; name: string; sector: string | null };
  watermark: string;
  snapshots: Array<{ price: number; volume: number | null; observedAt: string; freshness: string; source: string }>;
  events: Array<{ id: string; type: string; magnitude: number; explanation: string; confidence: number; detectedAt: string }>;
};

const userId = "demo-user";

export default function InstrumentDetail({ instrumentId }: { instrumentId: string }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/instrument/${instrumentId}`, { headers: { "x-user-id": userId } })
      .then((response) => { if (!response.ok) throw new Error("Instrument detail could not be loaded."); return response.json(); })
      .then(setData)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Instrument detail could not be loaded."));
  }, [instrumentId]);

  const points = useMemo(() => data?.snapshots.map((snapshot) => ({ time: Math.floor(new Date(snapshot.observedAt).getTime() / 1000), value: snapshot.price })) ?? [], [data]);
  const watermark = data ? Math.floor(new Date(data.watermark).getTime() / 1000) : 0;
  const markers = useMemo(() => data?.events.map((event) => ({ eventId: event.id, time: Math.floor(new Date(event.detectedAt).getTime() / 1000), position: event.magnitude >= 0 ? "aboveBar" as const : "belowBar" as const, color: event.type === "unexplained_move" ? "#ed5555" : "#f5a623", shape: "circle" as const, text: event.type.replaceAll("_", " ") })) ?? [], [data]);
  const latest = data?.snapshots.at(-1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const attributionRefs = useRef<Record<string, HTMLElement | null>>({});

  function focusAttribution(eventId: string) {
    setSelectedEventId(eventId);
    window.setTimeout(() => attributionRefs.current[eventId]?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  if (error) return <div className="detail-state"><strong>{error}</strong><Link href="/watchlist">Back to watchlist</Link></div>;
  if (!data) return <DetailSkeleton />;

  return (
    <div className="signal-app">
      <aside className="signal-sidebar"><div className="signal-brand"><span className="signal-mark">◆</span><span>Signal</span></div><div className="signal-search"><span>⌕</span><span>Search instrument</span></div><nav className="signal-nav" aria-label="Primary navigation"><Link href="/"><span>▦</span>Brief</Link><Link className="active" href="/watchlist"><span>▣</span>Watchlist</Link></nav><p className="signal-section-label">Monitoring</p><nav className="signal-nav"></nav><div className="signal-provider-status"><div><span className="status-dot live" />Replay feed · live</div><div><span className="status-dot warn" />Detection · ready</div></div></aside>
      <main className="signal-main detail-main"><div className="detail-top"><div><div className="signal-crumb"><Link href="/watchlist">⌂ / Watchlist</Link> / {data.instrument.symbol}</div><h1>{data.instrument.name}</h1><p>{data.instrument.exchange} · {data.instrument.symbol} · {data.instrument.sector ?? "Unclassified"}</p></div><Link className="back-link" href="/watchlist">Back to watchlist</Link></div><div className="detail-grid"><section className="signal-card chart-card"><div className="detail-card-heading"><div><span>Price history</span><strong>{latest ? latest.price.toFixed(2) : "—"}</strong></div><span className="freshness-cell"><span className="status-dot live" />{latest?.freshness ?? "unknown"} · {latest?.source ?? "—"}</span></div><PriceChart points={points} markers={markers} watermark={watermark} onMarkerClick={focusAttribution} /><div className="chart-caption"><span>Shaded band = time since your last watermark</span><span>{points.length} recorded observation{points.length === 1 ? "" : "s"}</span></div></section><section className="signal-card attribution-card"><div className="detail-card-heading"><span>Why did this move?</span><span>{data.events.length} event{data.events.length === 1 ? "" : "s"}</span></div>{data.events.length ? data.events.map((event) => <article className={`attribution-event ${selectedEventId === event.id ? "selected" : ""}`} ref={(element) => { attributionRefs.current[event.id] = element; }} key={event.id}><div className="attribution-title"><strong>{event.type.replaceAll("_", " ")}</strong><span>{Math.round(event.confidence * 100)}% confidence</span></div><p>{event.explanation}</p><small>{new Date(event.detectedAt).toLocaleString()}</small></article>) : <div className="detail-empty"><strong>No attributed cause found.</strong><p>This move remains unexplained. Signal will not invent a reason.</p></div>}</section></div><section className="signal-card detail-facts"><div className="detail-card-heading"><span>Data facts</span><span>Freshness stays visible</span></div><div className="facts-grid"><div><small>Observed</small><strong>{latest ? new Date(latest.observedAt).toLocaleString() : "—"}</strong></div><div><small>Volume</small><strong>{latest?.volume?.toLocaleString() ?? "—"}</strong></div><div><small>Watermark</small><strong>{new Date(data.watermark).toLocaleString()}</strong></div></div></section></main>
    </div>
  );
}

function DetailSkeleton() {
  return <div className="signal-app"><main className="signal-main detail-main"><div className="detail-top"><div><div className="skeleton skeleton-kicker" /><div className="skeleton skeleton-title" /><div className="skeleton skeleton-meta" /></div></div><div className="detail-grid"><section className="signal-card chart-card"><div className="skeleton skeleton-chart" /></section><section className="signal-card attribution-card"><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /><div className="skeleton skeleton-card" /></section></div><section className="signal-card detail-facts"><div className="skeleton skeleton-facts" /></section></main></div>;
}
