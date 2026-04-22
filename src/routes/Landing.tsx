import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center p-8 text-center">
      <div className="max-w-xl space-y-6">
        <h1 className="text-5xl font-bold tracking-tight">
          pig<span className="text-primary">mint</span>
        </h1>
        <p className="text-muted-foreground text-lg">
          Generate images and videos. Organize everything in one place.
        </p>
        <div className="flex gap-3 justify-center">
          <a
            href="/api/auth/login"
            className="inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Sign in
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          5 free image generations to get started.
        </p>
      </div>
      <footer className="absolute bottom-6 flex items-center gap-4 text-sm text-muted-foreground">
        <Link to="/terms" className="transition-colors hover:text-foreground">
          Terms
        </Link>
        <Link to="/privacy" className="transition-colors hover:text-foreground">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
