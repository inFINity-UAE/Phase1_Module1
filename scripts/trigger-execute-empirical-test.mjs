/**
 * Empirical test: does REVOKE EXECUTE on a trigger function affect trigger firing?
 * Runs against embedded PGlite (real Postgres engine) — no live project objects touched.
 *
 * Usage: node scripts/trigger-execute-empirical-test.mjs
 */
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();

const setupSql = `
create role service_role login password 'test';
create role authenticated login password 'test';
create role anon login password 'test';

create schema scratch;
revoke all on schema scratch from public;
grant usage on schema scratch to service_role;

create table scratch.exec_test (
  id serial primary key,
  val text not null default 'x'
);

create or replace function scratch.exec_test_trg()
returns trigger
language plpgsql
as $$
begin
  if new.val = 'BLOCK' then
    raise exception 'trigger fired and blocked insert';
  end if;
  return new;
end;
$$;

create trigger trg_exec_test
  before insert on scratch.exec_test
  for each row execute function scratch.exec_test_trg();

grant insert on scratch.exec_test to service_role;
grant usage, select on all sequences in schema scratch to service_role;
grant execute on function scratch.exec_test_trg() to service_role;
`;

async function tryInsert(label) {
  try {
    await db.exec('set role service_role');
    await db.query(`insert into scratch.exec_test (val) values ('BLOCK')`);
    await db.exec('reset role');
    return { label, outcome: 'INSERT_SUCCEEDED', triggerFired: false };
  } catch (e) {
    await db.exec('reset role');
    const msg = e?.message ?? String(e);
    if (msg.includes('trigger fired and blocked insert')) {
      return { label, outcome: 'INSERT_REJECTED_BY_TRIGGER', triggerFired: true };
    }
    return { label, outcome: 'INSERT_FAILED_OTHER', triggerFired: null, error: msg };
  }
}

async function grantsFor(fn) {
  const res = await db.query(`
    select grantee, privilege_type
      from information_schema.role_routine_grants
     where routine_schema = 'scratch'
       and routine_name = 'exec_test_trg'
     order by grantee, privilege_type
  `);
  return res.rows;
}

console.log('=== Empirical EXECUTE vs trigger firing (PGlite / Postgres) ===\n');

await db.exec(setupSql);

console.log('Phase A — service_role HAS EXECUTE (baseline)');
console.log('  grants:', await grantsFor());
const phaseA = await tryInsert('with EXECUTE');
console.log('  DML result:', phaseA);

await db.exec(`
  revoke all on function scratch.exec_test_trg() from public;
  revoke all on function scratch.exec_test_trg() from authenticated;
  revoke all on function scratch.exec_test_trg() from anon;
  revoke all on function scratch.exec_test_trg() from service_role;
`);

console.log('\nPhase B — service_role EXECUTE explicitly REVOKED');
console.log('  grants:', await grantsFor());
const phaseB = await tryInsert('without EXECUTE');
console.log('  DML result:', phaseB);

await db.exec(`grant execute on function scratch.exec_test_trg() to service_role;`);

console.log('\nPhase C — service_role EXECUTE re-granted (sanity)');
console.log('  grants:', await grantsFor());
const phaseC = await tryInsert('EXECUTE restored');
console.log('  DML result:', phaseC);

console.log('\n=== CONCLUSION ===');
if (phaseA.triggerFired && phaseB.triggerFired) {
  console.log(
    'REVOKE EXECUTE from service_role does NOT stop trigger firing — triggers fire independently of caller EXECUTE privilege.',
  );
} else if (phaseA.triggerFired && !phaseB.triggerFired) {
  console.log(
    'REVOKE EXECUTE from service_role DOES stop trigger firing — explicit grant execute to service_role is REQUIRED for backend DML.',
  );
} else if (!phaseA.triggerFired) {
  console.log('SETUP ERROR: baseline trigger did not fire — results invalid.');
  process.exit(1);
} else {
  console.log('INCONCLUSIVE — inspect Phase B error:', phaseB);
  process.exit(1);
}

await db.close();
