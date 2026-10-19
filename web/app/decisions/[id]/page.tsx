import { DecisionDetail } from "../../../components/decisions/DecisionDetail";

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DecisionDetail id={id} />;
}
