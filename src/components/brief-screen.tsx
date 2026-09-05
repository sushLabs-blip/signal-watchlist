"use client";

import { useEffect, useState } from "react";

type BriefEvent = {
  id: string;
  symbol: string;
  exchange: string;
  type: string;
  magnitude: string;
  explanation: string;
  confidence: string;
  detectedAt: string;
  salience: number;
};

type CalendarEvent = {
  symbol: string;
  title: string;
  scheduledFor: string;
  historicalReaction: string;
};

type BriefData = {
  watermark: { lastSeenAt: string; initialized: boolean };
  surfaced: BriefEvent[];
  suppressedCount: number;
  emptyState?: string;
  forwardLooking: { events: CalendarEvent[] };
};

const userId = "demo-user";

function formatAge(date: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  return `${minutes} min ago`;
}

function eventLabel(type: string) {
  return type.replaceAll("_", " ");
}

function eventTone(type: string) {
  if (type === "threshold_crossed") return "threshold";
  if (type === "corporate_action") return "corporate";
  if (type === "volume_anomaly") return "volume";
  return "signal";
}

export default function BriefScreen() {
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  async function loadBrief(isRefresh = false) {
    setLoading(true);
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/brief", { headers: { "x-user-id": userId } });
      if (!response.ok) throw new Error("Brief could not be loaded.");
      setBrief(await response.json());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Brief could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadBrief();
  }, []);

  async function acknowledge(eventId: string) {
    setAcknowledging(eventId);
    try {
      const response = await fetch("/api/brief/acknowledge", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": userId },
        body: JSON.stringify({ eventId, engagement: "acknowledged" }),
      });
      if (!response.ok) throw new Error("This card could not be acknowledged.");
      await loadBrief(true);
    } catch (acknowledgeError) {
      setError(acknowledgeError instanceof Error ? acknowledgeError.message : "This card could not be acknowledged.");
    } finally {
      setAcknowledging(null);
    }
  }

  const surfaced = brief?.surfaced ?? [];
  const suppressed = brief?.suppressedCount ?? 0;

  return (
    <div className="signal-app">
      <aside className="signal-sidebar">
        <div className="signal-brand"><span className="signal-mark">◆</span><span>Signal</span></div>
        <div className="signal-search"><span>⌕</span><span>Search instrument</span></div>
        <nav className="signal-nav" aria-label="Primary navigation">
          <a className="active" href="#brief"><span>▦</span>Brief</a>
          <a href="/watchlist"><span>▣</span>Watchlist</a>
          <a href="/calendar"><span>▤</span>Calendar</a>
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

      <main className="signal-main" id="brief">
        <header className="signal-topbar">
          <div>
            <div className="signal-crumb"><span>⌂</span> / Brief</div>
            <h1>Your brief</h1>
            <p>{brief?.watermark.initialized ? `Since ${formatAge(brief.watermark.lastSeenAt)}` : "Your first look at what matters"}</p>
          </div>
          <div className="signal-top-actions">
            <div className="freshness-pill"><span className="status-dot live" />Event stream · current</div>
            <button className="icon-button" onClick={() => void loadBrief(true)} aria-label="Refresh brief" title="Refresh brief">↻</button>
          </div>
        </header>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void loadBrief(true)} />
        ) : (
          <>
            <section className="summary-grid" aria-label="Brief summary">
              <div className="signal-card summary-card">
                <div className="card-heading"><span>Attention budget</span><span>5 shown</span></div>
                <strong className="summary-number">{surfaced.length} <small>of 5</small></strong>
                <p>items surfaced this session</p>
                <div className="budget-line"><span>Surfaced</span><i><b style={{ width: `${Math.min(surfaced.length * 20, 100)}%` }} /></i><strong>{surfaced.length}</strong></div>
                <div className="budget-line"><span>Suppressed</span><i><b className="blue-fill" style={{ width: `${Math.min(suppressed * 10, 100)}%` }} /></i><strong>{suppressed}</strong></div>
              </div>
              <div className="signal-card summary-card">
                <div className="card-heading"><span>Read state</span><span>{brief?.watermark.initialized ? "Engaged" : "New"}</span></div>
                <strong className="summary-number">{brief?.watermark.initialized ? "Live" : "Ready"}</strong>
                <p>{brief?.watermark.initialized ? "watermark advances on engagement" : "nothing is marked seen yet"}</p>
                <div className="read-state"><span className="status-dot live" />Passive viewing does not clear events</div>
              </div>
              <div className="signal-card principle-card">
                <div className="card-heading"><span>Signal principle</span><span>Today</span></div>
                <strong>Attention is finite.</strong>
                <p>When nothing meaningful happened, Signal says so plainly.</p>
              </div>
            </section>

            <section className="signal-lower-grid">
              <div className="signal-card brief-feed">
                <div className="feed-heading"><strong>What changed</strong><span>{refreshing ? "Refreshing…" : "Ranked by significance"}</span></div>
                {surfaced.length === 0 ? (
                  <EmptyState message={brief?.emptyState ?? "Nothing needs your attention right now."} />
                ) : (
                  <div className="brief-list">
                    {surfaced.map((event) => (
                      <article className="brief-event" key={event.id}>
                        <div className="event-topline">
                          <div className="event-symbol"><strong>{event.symbol}</strong><span>{event.exchange}</span></div>
                          <span className={`event-type ${eventTone(event.type)}`}>{eventLabel(event.type)}</span>
                        </div>
                        <p className="event-reason">{event.explanation}</p>
                        <div className="event-footer">
                          <span className="event-confidence">{Math.round(Number(event.confidence) * 100)}% confidence · {formatAge(event.detectedAt)}</span>
                          <span className="event-freshness"><span className="status-dot live" />Event data</span>
                          <button className="ack-button" disabled={acknowledging === event.id} onClick={() => void acknowledge(event.id)}>
                            {acknowledging === event.id ? "Acknowledging…" : "Acknowledge"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                <div className="quiet-tray"><span>{suppressed} changes suppressed as noise</span><span aria-hidden="true">⌄</span></div>
                <div className="forward-section" id="calendar">
                  <div className="forward-title">Coming up</div>
                  {brief?.forwardLooking.events.length ? brief.forwardLooking.events.map((event) => (
                    <div className="forward-row" key={`${event.symbol}-${event.title}`}>
                      <span><strong>{event.symbol}</strong> · {event.title}</span>
                      <span>{new Date(event.scheduledFor).toLocaleDateString(undefined, { weekday: "short" })} · {event.historicalReaction}</span>
                    </div>
                  )) : <div className="forward-empty">No scheduled events in the coming week.</div>}
                </div>
              </div>

              <div className="signal-card quiet-panel">
                <div className="feed-heading"><strong>Read honestly</strong><span>How Signal behaves</span></div>
                <div className="quiet-panel-body">
                  <div className="quiet-stat"><span className="status-dot live" /><div><strong>Freshness stays visible</strong><p>Every market fact carries its own age and source.</p></div></div>
                  <div className="quiet-stat"><span className="status-dot warn" /><div><strong>Noise stays out of the way</strong><p>{suppressed ? `${suppressed} lower-salience change${suppressed === 1 ? "" : "s"} hidden from the main brief.` : "No lower-salience changes are waiting."}</p></div></div>
                  <div className="quiet-stat"><span className="status-dot blue" /><div><strong>Your watermark is deliberate</strong><p>Only explicit acknowledgement changes what “since you last checked” means.</p></div></div>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-layout" aria-label="Loading brief" role="status">
      <div className="loading-summary"><span /><span /><span /></div>
      <div className="loading-columns"><div className="loading-feed"><span /><span /><span /></div><div className="loading-side"><span /><span /></div></div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-state" role="alert">
      <span className="error-mark">!</span>
      <strong>Signal could not load your brief.</strong>
      <p>{message}</p>
      <button className="retry-button" onClick={onRetry}>Retry</button>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <span className="empty-mark">✓</span>
      <strong>{message}</strong>
      <p>The brief is quiet. That is the product working as intended.</p>
    </div>
  );
}
