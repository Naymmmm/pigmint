import { Link, NavLink } from "react-router-dom";
import { Images, Sparkles, CreditCard, LogOut, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import PigmintLogo from "./PigmintLogo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { to: "/gallery", label: "Gallery", icon: Images },
  { to: "/compare", label: "Compare", icon: GitCompareArrows },
  { to: "/assistant", label: "Assistant", icon: Sparkles },
  { to: "/settings/billing", label: "Billing", icon: CreditCard },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Narrow icon rail — keeps more room for the bento canvas on the right. */}
      <aside className="w-16 border-r border-border bg-card/40 flex flex-col items-center py-4 gap-2">
        <nav className="flex flex-col gap-1 items-center">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                cn(
                  "grid place-items-center w-10 h-10 rounded-lg transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <Icon size={18} />
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Separator className="my-2 w-8" />
          <form method="POST" action="/api/auth/logout">
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              title="Sign out"
              className="text-muted-foreground"
            >
              <LogOut size={16} />
            </Button>
          </form>
        </div>
      </aside>

      {/* Right: top bar + page content. The top bar hosts the logo + page context. */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border flex items-center justify-between px-5 bg-card/30 backdrop-blur">
          <div className="flex items-center gap-4">
            <PigmintLogo />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">Terms</Link>
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
