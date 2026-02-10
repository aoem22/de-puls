import type { CrimeCategory } from '../types/crime';

export interface KreisSlugEntry {
  ags: string;
  slug: string;
  name: string;
  fullName: string;
  bundeslandCode: string;
  bundeslandSlug: string;
  type: 'stadt' | 'kreis';
}

export interface CrimeSlugEntry {
  key: CrimeCategory;
  slug: string;
  label: string;
}

export interface BundeslandSlugEntry {
  code: string;
  slug: string;
  name: string;
}
