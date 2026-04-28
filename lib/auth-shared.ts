import type { UserRole } from "@/lib/types"

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "main_admin":
      return "Main Admin"
    case "manager":
      return "Manager"
    case "member":
      return "Team Member"
  }
}
