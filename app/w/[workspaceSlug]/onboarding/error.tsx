"use client";
import { PeopleError } from "@/components/people/PageStates";
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) { return <PeopleError what="checklists" error={error} reset={retry} />; }
