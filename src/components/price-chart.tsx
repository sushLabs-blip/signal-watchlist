"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, createSeriesMarkers, type Time } from "lightweight-charts";

type ChartPoint = { time: number; value: number };
type ChartMarker = { eventId: string; time: number; position: "aboveBar" | "belowBar"; color: string; shape: "circle"; text: string };

export default function PriceChart({ points, markers, watermark, onMarkerClick }: { points: ChartPoint[]; markers: ChartMarker[]; watermark: number; onMarkerClick: (eventId: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 330,
      layout: { background: { type: ColorType.Solid, color: "#151817" }, textColor: "#777d79" },
      grid: { vertLines: { color: "#202422" }, horzLines: { color: "#202422" } },
      rightPriceScale: { borderColor: "#292d2b" },
      timeScale: { borderColor: "#292d2b", timeVisible: true },
    });
    const series = chart.addSeries(AreaSeries, { lineColor: "#35d58b", topColor: "rgba(53, 213, 139, .26)", bottomColor: "rgba(53, 213, 139, .02)", lineWidth: 2 });
    const uniquePoints = Array.from(new Map([...points].sort((a, b) => a.time - b.time).map((point) => [point.time, point])).values());
    series.setData(uniquePoints.map((point) => ({ ...point, time: point.time as Time })));
    const markerPlugin = createSeriesMarkers(series, markers.map(({ eventId, ...marker }) => ({ ...marker, time: marker.time as Time, id: eventId })));
    const handleChartClick = (param: Parameters<Parameters<typeof chart.subscribeClick>[0]>[0]) => {
      const clickedTime = typeof param.time === "number" ? param.time : undefined;
      const clickedMarker = clickedTime === undefined ? undefined : markers.find((marker) => marker.time === clickedTime);
      if (clickedMarker) onMarkerClick(clickedMarker.eventId);
    };
    chart.subscribeClick(handleChartClick);
    if (uniquePoints.length) chart.timeScale().fitContent();
    const resize = () => chart.applyOptions({ width: container.clientWidth });
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => { observer.disconnect(); chart.unsubscribeClick(handleChartClick); markerPlugin.detach(); chart.remove(); };
  }, [markers, onMarkerClick, points]);

  const firstTime = points[0]?.time ?? watermark;
  const lastTime = points.at(-1)?.time ?? watermark;
  const range = Math.max(lastTime - firstTime, 1);
  const bandPosition = Math.max(0, Math.min(100, ((watermark - firstTime) / range) * 100));
  return <div className="price-chart-wrap"><div className="since-band" style={{ left: `${bandPosition}%`, width: `${100 - bandPosition}%` }}><span>since your last check</span></div><div ref={containerRef} className="price-chart" /></div>;
}
