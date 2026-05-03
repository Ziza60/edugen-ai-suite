import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription, useMonthlyUsage } from "@/hooks/useSubscription";
import { LayoutDashboard, BookOpen, Award, LogOut, Sparkles, Menu, X, Star, CreditCard, BarChart3 } from "lucide-react";
import { useState } from "react";

const ACCENT = "#DF7C3A";
const GOLD = "#C9A96E";

export function AppLayout() {
  const { user, signOut } = useAuth();
  const { plan } = useSubscription();
  const { usage } = useMonthlyUsage();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const maxCourses = plan === "pro" ? 5 : 3;
  const usagePct = Math.min((usage / maxCourses) * 100, 100);

  const navItems = [
    { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/app/analytics", label: "Análises", icon: BarChart3 },
    { to: "/app/certificates", label: "Certificados", icon: Award },
    { to: "/app/planos", label: "Planos", icon: CreditCard },
  ];

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#0B0B0F", color: "#E8E3DC" }}>
      {/* Sidebar desktop */}
      <aside
        className="hidden lg:flex flex-col"
        style={{ width: "224px", background: "#08080C", borderRight: "1px solid rgba(232,227,220,0.06)", flexShrink: 0 }}
      >
        {/* Logo */}
        <div style={{ padding: "1.5rem 1.25rem", borderBottom: "1px solid rgba(232,227,220,0.05)" }}>
          <Link to="/app/dashboard" style={{ display: "flex", alignItems: "center", gap: "10px", textDecoration: "none" }}>
            <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: "rgba(223,124,58,0.12)", border: "1px solid rgba(223,124,58,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Sparkles className="h-4 w-4" style={{ color: ACCENT }} />
            </div>
            <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.125rem", fontWeight: 700, color: "#E8E3DC", letterSpacing: "-0.01em" }}>EduGen AI</span>
          </Link>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "1rem 0.75rem", display: "flex", flexDirection: "column", gap: "2px" }}>
          {navItems.map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "0.625rem 0.75rem", borderRadius: "8px",
                  fontSize: "0.875rem", fontWeight: active ? 500 : 400, textDecoration: "none", transition: "all 0.15s",
                  background: active ? "rgba(223,124,58,0.1)" : "transparent",
                  color: active ? ACCENT : "rgba(232,227,220,0.45)",
                  border: active ? "1px solid rgba(223,124,58,0.18)" : "1px solid transparent",
                }}
                onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "rgba(232,227,220,0.04)"; e.currentTarget.style.color = "#E8E3DC"; } }}
                onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,227,220,0.45)"; } }}
              >
                <item.icon className="h-4 w-4" style={{ flexShrink: 0 }} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div style={{ padding: "1rem 0.75rem", borderTop: "1px solid rgba(232,227,220,0.05)", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          {/* Plan + usage */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "0.6875rem", letterSpacing: "0.12em", textTransform: "uppercase", color: plan === "pro" ? GOLD : "rgba(232,227,220,0.35)", fontWeight: 600 }}>
                {plan.toUpperCase()}
              </span>
              <span style={{ fontSize: "0.6875rem", color: "rgba(232,227,220,0.3)" }}>{usage}/{maxCourses} cursos</span>
            </div>
            <div style={{ height: "3px", background: "rgba(232,227,220,0.08)", borderRadius: "100px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${usagePct}%`, background: usagePct >= 100 ? "#E06C75" : ACCENT, borderRadius: "100px", transition: "width 0.6s ease" }} />
            </div>
          </div>

          {plan === "free" && (
            <button
              onClick={() => navigate("/app/planos")}
              style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "0.5rem 0.75rem", borderRadius: "8px", background: "rgba(223,124,58,0.08)", border: "1px solid rgba(223,124,58,0.18)", color: ACCENT, fontSize: "0.8125rem", fontWeight: 500, cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(223,124,58,0.14)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(223,124,58,0.08)")}
            >
              <Star className="h-3.5 w-3.5" /> Upgrade para Pro
            </button>
          )}

          {/* User row */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "0.75rem", color: "rgba(232,227,220,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.email}</p>
            </div>
            <button
              onClick={signOut}
              title="Sair"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", borderRadius: "7px", background: "transparent", border: "none", color: "rgba(232,227,220,0.35)", cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(232,227,220,0.06)"; e.currentTarget.style.color = "#E8E3DC"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(232,227,220,0.35)"; }}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, background: "rgba(8,8,12,0.95)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(232,227,220,0.06)", padding: "0 1rem", height: "56px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link to="/app/dashboard" style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none" }}>
          <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: "rgba(223,124,58,0.12)", border: "1px solid rgba(223,124,58,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sparkles className="h-4 w-4" style={{ color: ACCENT }} />
          </div>
          <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.0625rem", fontWeight: 700, color: "#E8E3DC" }}>EduGen AI</span>
        </Link>
        <button onClick={() => setMobileOpen(!mobileOpen)} style={{ background: "transparent", border: "none", color: "rgba(232,227,220,0.6)", cursor: "pointer", padding: "4px" }}>
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile nav overlay */}
      {mobileOpen && (
        <div className="lg:hidden" style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(8,8,12,0.8)", backdropFilter: "blur(4px)" }} onClick={() => setMobileOpen(false)}>
          <div style={{ position: "absolute", top: "56px", left: 0, right: 0, background: "#0B0B0F", borderBottom: "1px solid rgba(232,227,220,0.06)", padding: "0.75rem" }} onClick={(e) => e.stopPropagation()}>
            {navItems.map((item) => {
              const active = isActive(item.to);
              return (
                <Link key={item.to} to={item.to} onClick={() => setMobileOpen(false)}
                  style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.75rem", borderRadius: "8px", fontSize: "0.875rem", fontWeight: active ? 500 : 400, textDecoration: "none", color: active ? ACCENT : "rgba(232,227,220,0.6)", background: active ? "rgba(223,124,58,0.08)" : "transparent", marginBottom: "2px" }}>
                  <item.icon className="h-4 w-4" /> {item.label}
                </Link>
              );
            })}
            {plan === "free" && (
              <button onClick={() => { setMobileOpen(false); navigate("/app/planos"); }}
                style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "0.75rem", borderRadius: "8px", color: ACCENT, fontSize: "0.875rem", fontWeight: 500, background: "transparent", border: "none", cursor: "pointer" }}>
                <Star className="h-4 w-4" /> Upgrade para Pro
              </button>
            )}
            <button onClick={signOut}
              style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "0.75rem", borderRadius: "8px", color: "rgba(232,227,220,0.45)", fontSize: "0.875rem", background: "transparent", border: "none", cursor: "pointer", marginTop: "4px" }}>
              <LogOut className="h-4 w-4" /> Sair
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main style={{ flex: 1, overflowX: "hidden" }}>
        <div className="lg:hidden" style={{ height: "56px" }} />
        <Outlet />
      </main>
    </div>
  );
}
