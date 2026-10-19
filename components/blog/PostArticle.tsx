import "./blog.css";

/**
 * One blog post as readers see it (public page and the admin preview).
 * `html` must already be sanitised (lib/blog/sanitize.ts).
 */
export function PostArticle({ title, dateLabel, dateTime, authorName, minutes, coverSrc, html }: { title: string; dateLabel: string | null; dateTime: string | null; authorName: string | null; minutes: number; coverSrc: string | null; html: string }) {
  return (
    <article className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
      <header className="flex flex-col gap-4">
        <h1 className="text-display-m text-ink">{title}</h1>
        <p className="text-body-ui text-ink-muted">
          {dateLabel && dateTime ? <time dateTime={dateTime}>{dateLabel}</time> : "Not published yet"}
          {authorName ? ` · ${authorName}` : ""}
          {` · ${minutes} min read`}
        </p>
      </header>
      {coverSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- covers come from our own scoped route, sized by CSS
        <img src={coverSrc} alt="" className="aspect-[2/1] w-full rounded-2xl border border-line object-cover" />
      ) : null}
      <div className="yy-prose sw-blog-prose" dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
}
