import type { RiskMap } from '../types';
export const renderJson = (map: RiskMap): string => JSON.stringify(map, null, 2) + '\n';
