import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";
import { LayoutDashboard, BookOpen, Award, LogOut, Sparkles, Menu, X, Star, CreditCard, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";

export function AppLayout() {
  const { user, signOut } = useAuth();
  const { plan } = useSubscription();
  const { usage } = useMonthlyUsage();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const maxCourses = plan === "pro" ? 5 : 3;

  const navItems = [
    { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/app/certificates", label: "Certificados", icon: Award },
    { to: "/app/planos", label: "Planos", icon: CreditCard },
  ];

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar - desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-sidebar border-r border-sidebar-border">
        <div className="p-6">
          <Link to="/app/dashboard" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-sidebar-primary-foreground" />
            </div>
            <span className="font-display text-xl font-bold text-sidebar-foreground">EduGen AI</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(item.to)
                  ? "bg-sidebar-accent text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Plan info + CTA */}
        <div className="p-4 border-t border-sidebar-border space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Badge variant={plan === "pro" ? "default" : "secondary"} className="text-xs">
                {plan.toUpperCase()}
              </Badge>
              <span className="text-xs text-sidebar-foreground/60">
                {usage}/{maxCourses} cursos/mês
              </span>
            </div>
            <Progress value={(usage / maxCourses) * 100} className="h-1.5" />
          </div>

          {plan === "free" && (
            <button
              onClick={() => navigate("/app/planos")}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium bg-sidebar-accent/60 text-sidebar-primary hover:bg-sidebar-accent transition-colors"
            >
              <Star className="h-3.5 w-3.5" />
              Upgrade para Pro
            </button>
          )}

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <Link to="/app/dashboard" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-display text-lg font-bold">EduGen AI</span>
        </Link>
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile nav overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)}>
          <div className="absolute top-14 left-0 right-0 bg-card border-b border-border p-4 space-y-1" onClick={(e) => e.stopPropagation()}>
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive(item.to) ? "bg-primary/10 text-primary" : "text-foreground/70 hover:bg-muted"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
            {plan === "free" && (
              <button
                onClick={() => { setMobileOpen(false); navigate("/app/planos"); }}
                className="flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                <Star className="h-4 w-4" />
                Upgrade para Pro
              </button>
            )}
            <Button variant="ghost" size="sm" className="w-full justify-start mt-2" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 lg:overflow-auto">
        <div className="lg:hidden h-14" />
        <Outlet />
      </main>
    </div>
  );
}
