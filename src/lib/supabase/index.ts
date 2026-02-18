// Re-export client and types for convenient imports
export { supabase } from './client';
export type { Database, CrimeRecordRow, CrimeRecordInsert, CrimeRecordUpdate, BlaulichtStats } from './types';
export type { AuslaenderRow, DeutschlandatlasRow, CityCrimeRow, DatasetMetaRow } from './types';
export { fetchCrimes, fetchCrimeById, fetchCrimeStats, fetchPipelineRuns } from './queries';
export { fetchAuslaenderByYear, fetchDeutschlandatlas, fetchAllCityCrimes, fetchDatasetMeta, fetchAllDatasetMeta } from './queries';
export { fetchDashboardStats, fetchCityRankingByCategory, fetchHotspotKreise, fetchLiveFeed } from './queries';
export { useCrimes, useCrimeDetail, useCrimeStats, usePipelineRuns, useSearchCrimes } from './hooks';
export { useAuslaenderData, useDeutschlandatlasData, useCityCrimeData, useAllDatasetMeta } from './hooks';
export { useDashboardStats, useCityRanking, useHotspotKreise, useLiveFeed } from './hooks';
