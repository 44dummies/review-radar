import type { Signal } from '../types';
import { sensitivePathSignal } from './sensitive-path';
import { blastRadiusSignal } from './blast-radius';
import { untestedChangeSignal } from './untested-change';
import { testGamingSignal } from './test-gaming';
import { dependencyChangeSignal } from './dependency-change';
import { churnSignal } from './churn';
import { sizeSignal } from './size';
import { diffusionSignal } from './diffusion';
import { externalSarifSignal } from './external-sarif';

export const defaultSignals: Signal[] = [
  sensitivePathSignal, blastRadiusSignal, untestedChangeSignal, testGamingSignal,
  dependencyChangeSignal, churnSignal, sizeSignal, diffusionSignal, externalSarifSignal,
];

export {
  sensitivePathSignal, blastRadiusSignal, untestedChangeSignal, testGamingSignal,
  dependencyChangeSignal, churnSignal, sizeSignal, diffusionSignal, externalSarifSignal,
};
