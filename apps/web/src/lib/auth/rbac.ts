// Role-based access. Roles are plain strings (consistent with TICKET_STATUS etc.).

export const USER_ROLES = ["ADMIN", "REVIEWER", "REQUESTER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_META: Record<UserRole, { label: string; blurb: string }> = {
  ADMIN: { label: "Admin", blurb: "Full access — users, agents, and the review gate" },
  REVIEWER: { label: "Reviewer", blurb: "Can approve or reject at the review gate" },
  REQUESTER: { label: "Requester", blurb: "Can submit requests and watch runs" },
};

export function isUserRole(v: string): v is UserRole {
  return (USER_ROLES as readonly string[]).includes(v);
}

export function roleMeta(role: string) {
  return ROLE_META[role as UserRole] ?? { label: role, blurb: "" };
}

type RoleHolder = { role: string } | null | undefined;

export function hasRole(u: RoleHolder, ...roles: UserRole[]): boolean {
  return !!u && (roles as string[]).includes(u.role);
}

/** Approve / reject at the review gate. */
export function canReview(u: RoleHolder): boolean {
  return hasRole(u, "ADMIN", "REVIEWER");
}

/** Create / edit / deactivate users. */
export function canManageUsers(u: RoleHolder): boolean {
  return hasRole(u, "ADMIN");
}

/** Edit the AI agent personas. */
export function canEditAgents(u: RoleHolder): boolean {
  return hasRole(u, "ADMIN");
}

/** Submit a new feature request. */
export function canSubmit(u: RoleHolder): boolean {
  return hasRole(u, "ADMIN", "REVIEWER", "REQUESTER");
}
