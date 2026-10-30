// Registers the pipeline stages that run after edits: reference resolution
// (Milestone 4) and validation (Milestone 5). Imported once by main.js and by
// tests that need the full pipeline.

import { registerStage } from './pipeline.js';
import { resolveBatch } from './reference/resolve.js';
import { validateBatch } from './validation/engine.js';

registerStage(({ suppliers, workspace }) => ({ refIndex: resolveBatch(suppliers, workspace) }));
registerStage(({ suppliers, existingSuppliers, excluded }) => ({ validation: validateBatch(suppliers, { existingSuppliers, excluded }) }));
