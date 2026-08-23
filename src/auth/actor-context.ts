import { CompanyRole } from '../common/enums/company-role.enum';

/** Verified caller identity + company role for entry-scoped journal actions. */
export interface ActorContext {
  id: string;
  role: CompanyRole;
}
