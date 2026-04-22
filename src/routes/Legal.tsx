import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { getLegalPage, type LegalPageSlug } from "@/lib/legal";

export default function Legal({ slug }: { slug: LegalPageSlug }) {
  const page = getLegalPage(slug);

  if (!page) {
    return null;
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 md:px-10 md:py-14">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft size={16} />
            Pigmint
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/terms"
              className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Terms
            </Link>
            <Link
              to="/privacy"
              className="rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Privacy
            </Link>
          </nav>
        </div>

        <header className="space-y-4 border-b border-border pb-8">
          <p className="text-sm font-medium text-primary">Effective {page.effectiveDate}</p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{page.title}</h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              {page.summary}
            </p>
          </div>
        </header>

        <div className="grid gap-6">
          {page.sections.map((section) => (
            <section
              key={section.heading}
              className="rounded-lg border border-border bg-card/60 p-5 shadow-sm md:p-6"
            >
              <h2 className="text-lg font-semibold tracking-tight">{section.heading}</h2>
              <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground md:text-base md:leading-7">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
