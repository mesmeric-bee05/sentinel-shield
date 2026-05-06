import { Link } from "@tanstack/react-router";
import { Activity, ShieldCheck } from "lucide-react";
import { useAuth, primaryRoute } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export function MarketingNav() {
  const { user, roles } = useAuth();
  return (
    <header className="sticky top-0 z-40 backdrop-blur bg-background/70 border-b border-border/60">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="relative w-9 h-9 rounded-lg bg-primary text-primary-foreground grid place-items-center shadow-glow">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="font-serif text-lg leading-none">ApexCare<span className="text-accent">.</span>AI</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Healthcare OS</div>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
          <Link to="/for-providers" className="hover:text-foreground transition" activeProps={{ className: "text-foreground" }}>For Providers</Link>
          <Link to="/security" className="hover:text-foreground transition" activeProps={{ className: "text-foreground" }}>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" />Security</span>
          </Link>
          <Link to="/about" className="hover:text-foreground transition" activeProps={{ className: "text-foreground" }}>About</Link>
          <Link to="/contact" className="hover:text-foreground transition" activeProps={{ className: "text-foreground" }}>Contact</Link>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild size="sm"><Link to={primaryRoute(roles)}>Open app</Link></Button>
          ) : (
            <>
              <Button asChild size="sm" variant="ghost"><Link to="/login">Sign in</Link></Button>
              <Button asChild size="sm"><Link to="/signup">Get started</Link></Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/60 mt-32">
      <div className="mx-auto max-w-7xl px-6 py-12 grid md:grid-cols-4 gap-8 text-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary text-primary-foreground grid place-items-center"><Activity className="w-4 h-4" /></div>
            <span className="font-serif text-lg">ApexCare.AI</span>
          </div>
          <p className="mt-3 text-muted-foreground">The AI-Powered Healthcare Operating System.</p>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Platform</div>
          <ul className="space-y-2">
            <li><Link to="/for-providers" className="hover:text-foreground">For Providers</Link></li>
            <li><Link to="/security" className="hover:text-foreground">Security</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Company</div>
          <ul className="space-y-2">
            <li><Link to="/about" className="hover:text-foreground">About</Link></li>
            <li><Link to="/contact" className="hover:text-foreground">Contact</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Trust</div>
          <ul className="space-y-2 text-muted-foreground">
            <li>HIPAA-aligned architecture</li>
            <li>Zero-Trust security model</li>
            <li>SOC 2 Type II — in progress</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} ApexCare AI. All rights reserved.
      </div>
    </footer>
  );
}
