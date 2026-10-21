import "server-only";

import { searchWorkspace } from "./workspace/search";
import { listMembers, listAnnouncements } from "./workspace/community";
import { financeSummary } from "./workspace/finance";
import { listMonitors, listIncidents } from "./workspace/services";
import { webSearch } from "./workspace/web-search";

export { filterSearchHits, type SearchHit } from "./workspace/search";
export { searxngUrl } from "./workspace/web-search";
export { searchWorkspace, listMembers, listAnnouncements, financeSummary, listMonitors, listIncidents, webSearch };

export const WORKSPACE_TOOLS = [searchWorkspace, listMembers, listAnnouncements, financeSummary, listMonitors, listIncidents, webSearch];
