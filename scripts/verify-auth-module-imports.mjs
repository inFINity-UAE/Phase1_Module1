/**
 * Static audit: every controller using CompanyMembershipGuard must live in a
 * Nest module that imports AuthModule (exports CompanyMembersService for DI).
 *
 * controller-auth-coverage.spec.ts mocks guards directly and cannot catch a
 * missing AuthModule on the real module graph — integration specs can, but
 * not every module has one. Run this before landing new tenant-scoped modules.
 *
 * Usage: node scripts/verify-auth-module-imports.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith('.controller.ts')) acc.push(p);
  }
  return acc;
}

function moduleForController(controllerPath) {
  const dir = path.dirname(controllerPath);
  const candidates = fs.readdirSync(dir).filter((f) => f.endsWith('.module.ts'));
  return candidates.length ? path.join(dir, candidates[0]) : null;
}

const guarded = walk(src).filter((f) =>
  /@UseGuards\([^)]*CompanyMembershipGuard/.test(fs.readFileSync(f, 'utf8')),
);

const rows = guarded.map((controllerPath) => {
  const mod = moduleForController(controllerPath);
  const modText = mod ? fs.readFileSync(mod, 'utf8') : '';
  const hasAuth = /\bAuthModule\b/.test(modText);
  return {
    controller: path.relative(src, controllerPath),
    module: mod ? path.relative(src, mod) : '(none)',
    ok: hasAuth,
  };
});

const missing = rows.filter((r) => !r.ok);

for (const r of rows.sort((a, b) => a.controller.localeCompare(b.controller))) {
  console.log(`${r.ok ? 'OK  ' : 'MISS'}  ${r.controller}  ->  ${r.module}`);
}

if (missing.length) {
  console.error(`\n${missing.length} module(s) missing AuthModule import.`);
  process.exit(1);
}

console.log(`\n${guarded.length} guarded controller file(s): all import AuthModule via their module.`);
