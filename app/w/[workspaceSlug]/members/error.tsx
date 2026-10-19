"use client";
import { PeopleError } from "@/components/people/PageStates";
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) { return <PeopleError what="members" error={error} reset={retry} />; }
