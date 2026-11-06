import { z } from 'zod';

const id = z.string().min(1);
const complexity = z.enum(['low', 'medium', 'high']);
const characteristic = z.number().int().min(0).max(5);
const characteristics = z.array(characteristic).length(14);

const devTypeSettings = z.object({
  modificationFactor: z.number().min(0),
  hoursPerFp: z.number().min(0).nullable(),
});

const software = z.object({
  id,
  name: z.string(),
  category1Ids: z.array(id),
  settings: z.object({
    defaultCharacteristics: characteristics,
    newDev: devTypeSettings,
    modDev: devTypeSettings,
    inHouseRatio: z.number().min(0).max(1),
    inHouseRate: z.number().min(0),
  }),
  vendorIds: z.array(id),
  seq: z.object({ DF: z.number().int(), TF: z.number().int(), EE: z.number().int() }),
  agentNotes: z.string().optional(),
});

const dfdNode = z.object({
  id,
  refType: z.enum(['dataFunction', 'transactionFunction', 'nonCountedProcess', 'externalEntity']),
  refId: id,
  x: z.number(),
  y: z.number(),
});

const dfdEdge = z.object({ id, sourceNodeId: id, targetNodeId: id, label: z.string() });

const feature = z.object({
  id,
  category2Id: id,
  name: z.string(),
  devType: z.enum(['new', 'modification']),
  characteristics,
  vendorId: id.nullable(),
  description: z.string().default(''),
  dfd: z.object({ nodes: z.array(dfdNode), edges: z.array(dfdEdge) }),
});

/** schemaVersion 1 のドキュメント（design.md 8.1） */
export const fpDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({ id, name: z.string(), softwareIds: z.array(id) }),
  softwares: z.record(z.string(), software),
  category1s: z.record(z.string(), z.object({ id, softwareId: id, name: z.string(), category2Ids: z.array(id) })),
  category2s: z.record(z.string(), z.object({ id, category1Id: id, name: z.string(), featureIds: z.array(id) })),
  features: z.record(z.string(), feature),
  dataFunctions: z.record(z.string(), z.object({
    id, softwareId: id, displayNo: z.string(), name: z.string(),
    kind: z.enum(['ILF', 'EIF']), complexity, ownerFeatureId: id.nullable(), description: z.string().default(''),
  })),
  transactionFunctions: z.record(z.string(), z.object({
    id, featureId: id, displayNo: z.string(), name: z.string(),
    kind: z.enum(['EI', 'EO', 'EQ']), complexity, description: z.string().default(''),
  })),
  nonCountedProcesses: z.record(z.string(), z.object({ id, featureId: id, name: z.string(), description: z.string().default('') })),
  externalEntities: z.record(z.string(), z.object({ id, softwareId: id, displayNo: z.string(), name: z.string(), description: z.string().default('') })),
  vendors: z.record(z.string(), z.object({ id, softwareId: id, name: z.string(), rate: z.number().min(0) })),
  backupSettings: z.object({ intervalSec: z.number().int().min(10), generations: z.number().int().min(1).max(50) }),
});
