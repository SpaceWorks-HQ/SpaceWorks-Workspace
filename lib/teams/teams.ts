import "server-only";

/**
 * Teams: crews inside the community (ops, events, infra, comms). Admins
 * create, edit and archive them; team leads manage their own members;
 * members join and leave public teams themselves. A PRIVATE team (and its
 * channels and projects, through `lib/teamAccess`) is invisible to anyone
 * outside it except admins.
 */

export { teamUrl } from "./teams/links";
export { listTeams, getTeam, teamWork } from "./teams/queries";
export { saveTeam, setTeamArchived } from "./teams/mutations";
export { addTeamMember, removeTeamMember, setTeamMemberRole, joinTeam } from "./teams/members";
