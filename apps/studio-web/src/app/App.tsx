import { useQuery } from "@tanstack/react-query";
import type { TwinApiClient } from "../api/client";
import { WorkspacePage } from "../features/workspace/WorkspacePage";
import { useIdentity } from "../auth/identity";
import { useI18n } from "../i18n/i18n";

export function App({ api }: { api: TwinApiClient }) {
  const { identity } = useIdentity();
  const { locale, setLocale, t } = useI18n();
  const readiness = useQuery({
    queryKey: ["readiness"],
    queryFn: ({ signal }) => api.readiness(signal),
    refetchInterval: 10_000,
    retry: false,
  });
  const ready = readiness.data?.persistence.ready === true;

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-mark" aria-label="Brash Robotics">
          <span className="brand-glyph" aria-hidden="true">B</span>
          <span>
            <strong>BRASH</strong>
            <small>TWIN STUDIO</small>
          </span>
        </div>
        <nav className="primary-nav">
          <NavItem icon="grid" label={t("workspace")} active />
          <NavItem icon="scan" label={t("surveys")} disabled />
          <NavItem icon="cube" label={t("assets")} disabled />
          <NavItem icon="delta" label={t("changes")} disabled />
          <NavItem icon="release" label={t("releases")} disabled />
        </nav>
        <div className="sidebar-footer">
          <span className={`connection-dot ${ready ? "is-ready" : "is-offline"}`} />
          <span>
            <strong>{ready ? t("apiReady") : t("apiOffline")}</strong>
            <small>{readiness.data?.persistence.mode ?? "disconnected"}</small>
          </span>
        </div>
      </aside>

      <div className="app-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">BRASH ROBOTICS / DIGITAL TWIN</p>
            <h1>{t("product")}</h1>
          </div>
          <div className="topbar-actions">
            <label className="locale-control">
              <span className="sr-only">Language</span>
              <select value={locale} onChange={(event) => setLocale(event.target.value as "en" | "tr")}>
                <option value="en">EN</option>
                <option value="tr">TR</option>
              </select>
            </label>
            <div className="identity-chip" title={`${t("localIdentity")}: ${identity.subject}`}>
              <span className="avatar">{initials(identity.displayName)}</span>
              <span>
                <strong>{identity.displayName}</strong>
                <small>{identity.roles[0]?.replaceAll("_", " ")}</small>
              </span>
            </div>
          </div>
        </header>
        <main>
          <WorkspacePage api={api} />
        </main>
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  disabled = false,
}: {
  icon: "grid" | "scan" | "cube" | "delta" | "release";
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button className={`nav-item ${active ? "is-active" : ""}`} type="button" disabled={disabled}>
      <Icon name={icon} />
      <span>{label}</span>
      {disabled && <span className="nav-soon">SOON</span>}
    </button>
  );
}

function Icon({ name }: { name: "grid" | "scan" | "cube" | "delta" | "release" }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>,
    scan: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><path d="M7 12h10M12 7v10" /></>,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></>,
    delta: <><path d="M12 3 3 20h18Z" /><path d="M12 9v5M12 17h.01" /></>,
    release: <><path d="M6 3h9l3 3v15H6Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function initials(displayName: string): string {
  return displayName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}
