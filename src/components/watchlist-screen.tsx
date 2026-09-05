"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type WatchlistItem = {
  id: string;
  priceThreshold: number | null;
  latestPrice: number | null;
  priceObservedAt: string | null;
  freshness: "live" | "delayed" | "stale" | "closed";
  source: string | null;
  significanceScore: number;
  latestSignificance: { type: string; explanation: string; detectedAt: string } | null;
  instrument: { id: string; symbol: string; exchange: string; name: string; sector: string | null };
};

type Watchlist = { id: string; name: string; items: WatchlistItem[] };
type WatchlistResponse = { watchlists: Watchlist[] };
type InstrumentResult = { id: string; symbol: string; name: string; exchange: string; sector: string | null };

const userId = "demo-user";

function freshnessLabel(freshness: WatchlistItem["freshness"]) {
  return freshness.charAt(0).toUpperCase() + freshness.slice(1);
}

function formatPrice(price: number | null) {
  return price === null ? "—" : price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function WatchlistScreen() {
  const [data, setData] = useState<WatchlistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [thresholdDraft, setThresholdDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<InstrumentResult[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  async function loadWatchlist() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/watchlist", { headers: { "x-user-id": userId } });
      if (!response.ok) throw new Error("Watchlist could not be loaded.");
      setData(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Watchlist could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadWatchlist();
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!search.trim()) { setSearchResults([]); return; }
      const response = await fetch(`/api/instruments?q=${encodeURIComponent(search.trim())}`);
      if (response.ok) setSearchResults((await response.json()).instruments);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  async function addInstrument(result: InstrumentResult) {
    if (!selectedWatchlist) return;
    setAdding(result.id);
    const response = await fetch(`/api/watchlist/${selectedWatchlist.id}/items/${result.id}`, { method: "POST", headers: { "x-user-id": userId } });
    if (response.ok || response.status === 409) { setSearch(""); setSearchResults([]); await loadWatchlist(); }
    setAdding(null);
  }

  async function createInstrument() {
    const symbol = search.trim().toUpperCase();
    const response = await fetch("/api/instruments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol }) });
    if (response.ok) { const result = (await response.json()).instrument as InstrumentResult; await addInstrument(result); }
  }

  const selectedWatchlist = data?.watchlists[0] ?? null;
  const items = useMemo(
    () => [...(selectedWatchlist?.items ?? [])].sort((left, right) => right.significanceScore - left.significanceScore),
    [selectedWatchlist],
  );
  const degraded = items.some((item) => item.freshness !== "live");

  function beginThresholdEdit(item: WatchlistItem) {
    setEditingId(item.id);
    setThresholdDraft(item.priceThreshold === null ? "" : String(item.priceThreshold));
  }

  async function saveThreshold(item: WatchlistItem) {
    const value = thresholdDraft.trim() === "" ? null : Number(thresholdDraft);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError("Threshold must be a non-negative number.");
      return;
    }

    setSavingId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/watchlist/${selectedWatchlist?.id}/items/${item.instrument.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-user-id": userId },
        body: JSON.stringify({ priceThreshold: value }),
      });
      if (!response.ok) throw new Error("Threshold could not be saved.");
      setEditingId(null);
      await loadWatchlist();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Threshold could not be saved.");
    } finally {
      setSavingId(null);
    }
  }

  async function removeInstrument(item: WatchlistItem) {
    if (!selectedWatchlist) return;
    setError(null);
    const response = await fetch(`/api/watchlist/${selectedWatchlist.id}/items/${item.instrument.id}`, { method: "DELETE", headers: { "x-user-id": userId } });
    if (!response.ok) { setError("Instrument could not be removed."); return; }
    await loadWatchlist();
  }

  return (
    <div className="signal-app">
      <aside className="signal-sidebar">
        <div className="signal-brand"><span className="signal-mark">◆</span><span>Signal</span></div>
        <div className="signal-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search instrument" aria-label="Search instrument" /></div>
        {search && <div className="instrument-search-results">{searchResults.length ? searchResults.map((result) => <button key={result.id} onClick={() => void addInstrument(result)} disabled={adding === result.id}><strong>{result.symbol}</strong><small>{result.name} · {result.exchange}</small><span>{adding === result.id ? "Adding…" : "Add"}</span></button>) : <><span>No matching instruments.</span><button className="create-instrument" onClick={() => void createInstrument()}>Create “{search.trim().toUpperCase()}” and add</button></>}</div>}
        <nav className="signal-nav" aria-label="Primary navigation">
          <a href="/"><span>▦</span>Brief</a>
          <a href="/calendar"><span>▤</span>Calendar</a>
          <a className="active" href="/watchlist"><span>▣</span>Watchlist</a>
        </nav>
        <p className="signal-section-label">Monitoring</p>
        <nav className="signal-nav">
          <a href="/thresholds"><span>⚑</span>Thresholds</a>
          <a href="/corrections"><span>✎</span>Corrections</a>
        </nav>
        <div className="signal-provider-status">
          <div><span className="status-dot live" />Replay feed · live</div>
          <div><span className="status-dot warn" />Detection · ready</div>
        </div>
      </aside>

      <main className="signal-main">
        <header className="signal-topbar">
          <div>
            <div className="signal-crumb"><span>⌂</span> / Watchlist</div>
            <h1>{selectedWatchlist?.name ?? "Watchlist"}</h1>
            <p>{selectedWatchlist ? `${items.length} instruments · sorted by significance` : "Your instruments, ranked by what deserves attention"}</p>
          </div>
          <div className="signal-top-actions">
            <div className="freshness-pill"><span className={`status-dot ${degraded ? "warn" : "live"}`} />{degraded ? "Data partially delayed" : "Data current"}</div>
            <button className="icon-button" onClick={() => void loadWatchlist()} aria-label="Refresh watchlist" title="Refresh watchlist">↻</button>
          </div>
        </header>

        {error && <div className="signal-error" role="alert">{error}</div>}
        {loading ? <WatchlistLoading /> : !selectedWatchlist ? <WatchlistEmpty /> : (
          <>
            {degraded && <div className="degraded-banner"><span className="status-dot warn" />Some prices are delayed or stale. Signal keeps the age visible and does not treat aged data as live.</div>}
            <section className="signal-card watchlist-card">
              <div className="watchlist-heading"><div><strong>Instruments</strong><span>Significance first · freshness on every row</span></div><span>{items.length} tracked</span></div>
              <div className="watchlist-table-wrap">
                <table className="watchlist-table">
                  <thead><tr><th>Instrument</th><th>Price</th><th>Signal</th><th>Threshold</th><th>Freshness</th><th>Actions</th></tr></thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td><Link className="watchlist-instrument-link" href={`/instrument/${item.instrument.id}`}><div className="watchlist-name"><strong>{item.instrument.name}</strong><small>{item.instrument.exchange} · {item.instrument.symbol}</small></div></Link></td>
                        <td><strong>{formatPrice(item.latestPrice)}</strong></td>
                        <td><div className="signal-score"><span className="score-track"><i style={{ width: `${Math.min(item.significanceScore * 30, 100)}%` }} /></span><span>{item.significanceScore.toFixed(2)}</span></div><small className="signal-detail">{item.latestSignificance?.type.replaceAll("_", " ") ?? "No recent signal"}</small></td>
                        <td>
                          {editingId === item.id ? (
                            <div className="threshold-edit"><input autoFocus value={thresholdDraft} onChange={(event) => setThresholdDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveThreshold(item); if (event.key === "Escape") setEditingId(null); }} placeholder="Optional" aria-label={`Threshold for ${item.instrument.symbol}`} /><button disabled={savingId === item.id} onClick={() => void saveThreshold(item)}>{savingId === item.id ? "…" : "Save"}</button></div>
                          ) : <button className="threshold-value" onClick={() => beginThresholdEdit(item)}>{item.priceThreshold === null ? "Set threshold" : item.priceThreshold.toFixed(2)}</button>}
                        </td>
                        <td><span className="freshness-cell"><span className={`status-dot ${item.freshness === "live" ? "live" : item.freshness === "delayed" ? "warn" : "stale"}`} />{freshnessLabel(item.freshness)}<small>{item.source ?? "No snapshot"}</small></span></td>
                        <td><button className="remove-instrument" onClick={() => void removeInstrument(item)} aria-label={`Remove ${item.instrument.symbol}`}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function WatchlistLoading() {
  return <div className="watchlist-loading" role="status" aria-label="Loading watchlist"><span /><span /><span /><span /></div>;
}

function WatchlistEmpty() {
  return <div className="watchlist-empty"><span className="empty-mark">+</span><strong>No watchlist yet.</strong><p>Create a watchlist and add instruments to see ranked market data here.</p></div>;
}
