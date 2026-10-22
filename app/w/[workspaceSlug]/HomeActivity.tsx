import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/display";
import { formatRelativeTime } from "@/lib/format/datetime";

export function HomeActivity({
  activity,
  base,
  tz,
}: {
  activity: { id: string; summary: string; createdAt: Date }[];
  base: string;
  tz: string;
}) {
  return (
    <Card>
      <CardHeader
        title="Activity"
        action={
          <Link
            className="inline-flex min-h-11 items-center underline"
            href={`${base}/activity`}
          >
            See all
          </Link>
        }
      />
      {activity.length ? (
        <ul className="divide-y divide-line">
          {activity.map((a) => (
            <li className="py-3" key={a.id}>
              <p className="break-words text-body-ui">{a.summary}</p>
              <time
                className="text-caption text-ink-muted"
                dateTime={a.createdAt.toISOString()}
              >
                {formatRelativeTime(a.createdAt, tz)}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          It’s quiet here.{" "}
          <Link className="underline" href={`${base}/activity`}>
            Open activity
          </Link>
        </p>
      )}
    </Card>
  );
}
