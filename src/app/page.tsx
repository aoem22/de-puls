import { DashboardPage } from '@/components/Dashboard/DashboardPage';
import { buildDashboardOverview } from '@/lib/supabase/build-overview';

export const revalidate = 60; // ISR: regenerate every 60s so SSR data stays fresh

export default async function Home() {
  let initialData;
  try {
    initialData = await buildDashboardOverview({
      timeframe: 'year_to_date',
    });
  } catch {
    // SSR prefetch failed — DashboardPage will fall back to client-side fetch
  }

  return <DashboardPage initialData={initialData} />;
}
