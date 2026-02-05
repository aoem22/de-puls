// Re-export client and types for convenient imports
export { supabase } from './client';
export type { Database, CrimeRecordRow, CrimeRecordInsert, CrimeRecordUpdate, LatLngBounds, BlaulichtStats } from './types';
export type { AuslaenderRow, DeutschlandatlasRow, CityCrimeRow, DatasetMetaRow } from './types';
export { fetchCrimes, fetchCrimesInBounds, fetchCrimeStats, fetchCrimeById } from './queries';
export { fetchAuslaenderByYear, fetchDeutschlandatlas, fetchAllCityCrimes, fetchDatasetMeta, fetchAllDatasetMeta } from './queries';
export { useCrimes, useCrimeStats } from './hooks';
export { useAuslaenderData, useDeutschlandatlasData, useCityCrimeData, useAllDatasetMeta } from './hooks';
