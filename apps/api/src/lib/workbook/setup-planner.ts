// Country setup import plan: organisation tabs, then Users, then the removal
// guards that need both. Pure — the routes call this for preview and again
// for apply (whose fingerprint must match the preview's).

import { ImportPlan, finalisePlan } from './plan';
import { TAB, ParsedSetup } from './setup-format';
import { SetupSnapshot } from './setup-snapshot';
import { ORG_TABS, OrgOp, OrgTab, planOrgTabs, checkOrgRemovals } from './setup-org';
import { UserOp, planUsersTab } from './setup-users';

export interface SetupOps { org: Record<OrgTab, OrgOp[]>; users: UserOp[] }
export interface SetupPlanResult { plan: ImportPlan; ops: SetupOps }

export function planSetupImport(parsed: ParsedSetup, snap: SetupSnapshot, actorUserId: number): SetupPlanResult {
  const org = planOrgTabs(parsed, snap);
  const users = planUsersTab(parsed[TAB.users], snap, org, actorUserId);
  checkOrgRemovals(org, users.state);

  const tabs = [...ORG_TABS.map((t) => org[t].plan), users.plan];
  const orgOps = Object.fromEntries(ORG_TABS.map((t) => [t, org[t].ops])) as Record<OrgTab, OrgOp[]>;
  return { plan: finalisePlan(tabs), ops: { org: orgOps, users: users.ops } };
}
