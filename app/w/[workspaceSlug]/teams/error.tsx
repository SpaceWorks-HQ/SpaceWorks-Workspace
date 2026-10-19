"use client";
import { PeopleError } from "@/components/people/PageStates";
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) { return <PeopleError what="teams" error={error} reset={retry} />; }
