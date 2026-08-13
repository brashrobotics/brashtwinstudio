import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";

export type StudioRole = "MAPPING_OPERATOR" | "MAP_APPROVER" | "FACTORY_MANAGER";

export interface StudioIdentity {
  subject: string;
  displayName: string;
  roles: StudioRole[];
  source: "local-development" | "oidc";
}

export interface IdentityAdapter {
  load(): StudioIdentity;
  save(identity: StudioIdentity): void;
}

const DEFAULT_IDENTITY: StudioIdentity = {
  subject: "local-operator",
  displayName: "Local Operator",
  roles: ["MAPPING_OPERATOR"],
  source: "local-development",
};

export class LocalIdentityAdapter implements IdentityAdapter {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage) {}

  load(): StudioIdentity {
    const encoded = this.storage.getItem("brash-twin.identity");
    if (!encoded) return DEFAULT_IDENTITY;
    try {
      return normalizeIdentity(JSON.parse(encoded));
    } catch {
      return DEFAULT_IDENTITY;
    }
  }

  save(identity: StudioIdentity): void {
    this.storage.setItem("brash-twin.identity", JSON.stringify(normalizeIdentity(identity)));
  }
}

interface IdentityContextValue {
  identity: StudioIdentity;
  updateIdentity(identity: StudioIdentity): void;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({
  children,
  adapter = new LocalIdentityAdapter(),
}: PropsWithChildren<{ adapter?: IdentityAdapter }>) {
  const [identity, setIdentity] = useState(() => adapter.load());
  const value = useMemo<IdentityContextValue>(() => ({
    identity,
    updateIdentity(nextIdentity) {
      const normalized = normalizeIdentity(nextIdentity);
      adapter.save(normalized);
      setIdentity(normalized);
    },
  }), [adapter, identity]);
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("useIdentity must be used inside IdentityProvider.");
  return value;
}

function normalizeIdentity(value: unknown): StudioIdentity {
  if (!value || typeof value !== "object") return DEFAULT_IDENTITY;
  const candidate = value as Partial<StudioIdentity>;
  const roles = Array.isArray(candidate.roles)
    ? candidate.roles.filter((role): role is StudioRole => [
      "MAPPING_OPERATOR",
      "MAP_APPROVER",
      "FACTORY_MANAGER",
    ].includes(role))
    : [];
  if (typeof candidate.subject !== "string" || candidate.subject.trim() === "") return DEFAULT_IDENTITY;
  if (typeof candidate.displayName !== "string" || candidate.displayName.trim() === "") return DEFAULT_IDENTITY;
  return {
    subject: candidate.subject,
    displayName: candidate.displayName,
    roles: roles.length > 0 ? roles : ["MAPPING_OPERATOR"],
    source: candidate.source === "oidc" ? "oidc" : "local-development",
  };
}
