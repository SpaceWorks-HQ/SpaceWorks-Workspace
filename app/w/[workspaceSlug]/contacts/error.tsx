"use client";
import { PeopleError } from "@/components/people/PageStates";
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) { return <PeopleError what="relationships" error={error} reset={retry} />; }
