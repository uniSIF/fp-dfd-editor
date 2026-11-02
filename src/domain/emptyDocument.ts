import { CHARACTERISTIC_COUNT } from './fpTables';
import { newId } from './ids';
import type { FpDocument, Software, SoftwareSettings } from './types';

export const DEFAULT_BACKUP_SETTINGS = { intervalSec: 60, generations: 10 };

export function defaultSoftwareSettings(): SoftwareSettings {
  return {
    defaultCharacteristics: Array(CHARACTERISTIC_COUNT).fill(0),
    newDev: { modificationFactor: 1, hoursPerFp: null },
    modDev: { modificationFactor: 1, hoursPerFp: null },
    inHouseRatio: 1,
    inHouseRate: 0,
  };
}

export function createSoftware(name: string, id: string = newId()): Software {
  return {
    id,
    name,
    category1Ids: [],
    settings: defaultSoftwareSettings(),
    vendorIds: [],
    seq: { DF: 1, TF: 1, EE: 1 },
  };
}

export function emptyDocument(projectName = '新しいプロジェクト'): FpDocument {
  return {
    schemaVersion: 1,
    project: { id: newId(), name: projectName, softwareIds: [] },
    softwares: {},
    category1s: {},
    category2s: {},
    features: {},
    dataFunctions: {},
    transactionFunctions: {},
    nonCountedProcesses: {},
    externalEntities: {},
    vendors: {},
    backupSettings: { ...DEFAULT_BACKUP_SETTINGS },
  };
}
