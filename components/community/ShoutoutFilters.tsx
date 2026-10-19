"use client";

import { useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/choice";
import { Dropdown } from "@/components/ui/field";
import type { MemberOption } from "@/components/community/ShoutoutComposer";

/** Filter the wall by person (received or given). State lives in the URL. */
export function ShoutoutFilters({ slug, members, personId, direction }: { slug: string; members: MemberOption[]; personId: string | null; direction: "received" | "given" }) {
  const router = useRouter();
  const go = (person: string, dir: "received" | "given") => {
    const params = new URLSearchParams();
    if (person) params.set("person", person);
    if (person && dir === "given") params.set("dir", "given");
    const query = params.toString();
    router.push(`/w/${slug}/shoutouts${query ? `?${query}` : ""}`);
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="sm:w-64">
        <Dropdown aria-label="Filter by person" value={personId ?? ""} onChange={(event) => go(event.target.value, direction)}>
          <option value="">Everyone</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </Dropdown>
      </div>
      {personId ? (
        <SegmentedControl<"received" | "given">
          ariaLabel="Shoutouts received or given"
          value={direction}
          onValueChange={(next) => go(personId, next)}
          options={[
            { value: "received", label: "Received" },
            { value: "given", label: "Given" },
          ]}
        />
      ) : null}
    </div>
  );
}
