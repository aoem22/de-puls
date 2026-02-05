/**
 * Database types for Supabase integration
 * These types match the crime_records table schema
 */

import type { CrimeCategory, LocationPrecision, WeaponType } from '../types/crime';

/**
 * Database row type (snake_case as stored in PostgreSQL)
 */
export interface CrimeRecordRow {
  id: string;
  title: string;
  summary: string | null;
  body: string | null;
  published_at: string;
  source_url: string;
  source_agency: string | null;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  precision: LocationPrecision;
  categories: CrimeCategory[];
  weapon_type: WeaponType | null;
  confidence: number;
  created_at: string;
  updated_at: string;
}

/**
 * Insert type for creating new records (omits auto-generated fields)
 */
export type CrimeRecordInsert = Omit<CrimeRecordRow, 'created_at' | 'updated_at'>;

/**
 * Update type for modifying existing records (all fields optional except id)
 */
export type CrimeRecordUpdate = Partial<Omit<CrimeRecordRow, 'id' | 'created_at'>> & {
  updated_at?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/**
 * Supabase Database schema definition
 * JSONB columns use Json type for compatibility with supabase-js.
 * Application code casts rows to rich types (AuslaenderRow, etc.) after fetching.
 */
export interface Database {
  public: {
    Tables: {
      crime_records: {
        Row: CrimeRecordRow;
        Insert: CrimeRecordInsert;
        Update: CrimeRecordUpdate;
      };
      auslaender_data: {
        Row: { ags: string; year: string; name: string; regions: Json };
        Insert: { ags: string; year: string; name: string; regions: Json };
        Update: Partial<{ ags: string; year: string; name: string; regions: Json }>;
      };
      deutschlandatlas_data: {
        Row: { ags: string; year: string; name: string; indicators: Json };
        Insert: { ags: string; year: string; name: string; indicators: Json };
        Update: Partial<{ ags: string; year: string; name: string; indicators: Json }>;
      };
      city_crime_data: {
        Row: { ags: string; year: string; name: string; crimes: Json };
        Insert: { ags: string; year: string; name: string; crimes: Json };
        Update: Partial<{ ags: string; year: string; name: string; crimes: Json }>;
      };
      dataset_meta: {
        Row: { dataset: string; years: string[]; source: string | null; description: string | null; updated_at: string };
        Insert: { dataset: string; years: string[]; source: string | null; description: string | null };
        Update: Partial<{ dataset: string; years: string[]; source: string | null; description: string | null }>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}

/**
 * Bounding box type for spatial queries
 */
export interface LatLngBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Statistics type for Blaulicht data
 */
export interface BlaulichtStats {
  total: number;
  geocoded: number;
  byCategory: Partial<Record<CrimeCategory, number>>;
}

// ============ Indicator Data Types ============

/**
 * Ausländer data row - one row per Kreis per year
 */
export interface AuslaenderRow {
  ags: string;
  year: string;
  name: string;
  regions: Record<string, { male: number | null; female: number | null; total: number | null }>;
}

/**
 * Deutschlandatlas data row - one row per Kreis (single year)
 */
export interface DeutschlandatlasRow {
  ags: string;
  year: string;
  name: string;
  indicators: Record<string, number | null>;
}

/**
 * City crime data row - one row per city per year
 */
export interface CityCrimeRow {
  ags: string;
  year: string;
  name: string;
  crimes: Record<string, { cases: number; hz: number; aq: number }>;
}

/**
 * Dataset metadata row - available years, source info
 */
export interface DatasetMetaRow {
  dataset: string;
  years: string[];
  source: string | null;
  description: string | null;
  updated_at: string;
}
