import { CompanyRole } from '../common/enums/company-role.enum';

/** Session identity from SupabaseAuthGuard; role set by company membership resolution. */
export interface AuthenticatedUser {
  id: string;
  role?: CompanyRole;
}
