import InstrumentDetail from "@/components/instrument-detail";

export default async function InstrumentDetailPage({ params }: { params: Promise<{ instrumentId: string }> }) {
  const { instrumentId } = await params;
  return <InstrumentDetail instrumentId={instrumentId} />;
}