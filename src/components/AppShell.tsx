import { Link, NavLink } from "react-router-dom";
import { Images, Sparkles, CreditCard, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/gallery", label: "Gallery", icon: Images },
  { to: "/assistant", label: "Assistant", icon: Sparkles },
  { to: "/settings/billing", label: "Billing", icon: CreditCard },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 border-r border-border bg-card/40 p-4 flex flex-col gap-2">
        <Link to="/gallery" className="font-semibold text-lg px-3 py-2">
          pigmint
        </Link>
        <nav className="flex flex-col gap-1 mt-2">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="flex items-center gap-3 px-3 text-xs text-muted-foreground">
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
          </div>
          <form method="POST" action="/api/auth/logout">
            <button className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground w-full">
              <LogOut size={16} /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
