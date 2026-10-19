"use client";
import type { DestinationHealth, DestinationKind, RuleScopeType } from "@prisma/client";
export type PickableDestination = { id: string; name: string; kind: DestinationKind; health: DestinationHealth };
/** The owning action validates the entity and persists these ids with setScopedDestinations. */
export function DestinationPicker({ scopeType, scopeId, destinations, value, onChange }: { scopeType: Exclude<RuleScopeType, "WORKSPACE">; scopeId: string; destinations: PickableDestination[]; value: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset className="space-y-2" data-scope-type={scopeType} data-scope-id={scopeId}>
    <legend className="text-label">Send to</legend>
    {destinations.length === 0 ? <p className="text-caption text-ink-muted">No destinations available. Ask an admin to add one in notification settings.</p> : destinations.map(d => <label className="flex min-h-11 items-center gap-3" key={d.id}><input type="checkbox" name="destinationIds" value={d.id} checked={value.includes(d.id)} onChange={e => onChange(e.target.checked ? [...value, d.id] : value.filter(id => id !== d.id))} />{d.name}{d.health === "ERROR" ? <span className="text-danger-fg">Needs attention</span> : null}</label>)}
  </fieldset>;
}
