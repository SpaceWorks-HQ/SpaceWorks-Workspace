import "server-only";

/**
 * Docs business rules. Server Actions (app/actions/docs.ts) resolve the
 * workspace and membership, rate limit and validate, then call these; tests
 * call them directly. Every query filters by workspace, and a doc the actor
 * may not see answers exactly like a missing one.
 *
 * Doc HTML is canonical: the editor sends HTML, it is sanitised here, and
 * `content` (editor JSON) is cleared so it can never go stale.
 */

export { createDoc, listDocTemplates, saveDoc, type TemplateChoice } from "./service/content";
export {
  DOC_CONFLICT,
  DOC_NOT_ALLOWED,
  DOC_NOT_FOUND,
  adminUserIds,
  docUrl,
  normalizeTitle,
  syncDocSearch,
  visibleDocsWhere,
  type DocResult,
  type DocsActor,
} from "./service/context";
export { listTreeDocs, searchDocs } from "./service/queries";
export { restoreRevision, verifyDoc } from "./service/revisions";
export { archiveDoc, duplicateDoc, moveDoc, restoreDoc, setDocVisibility } from "./service/treeMutations";
