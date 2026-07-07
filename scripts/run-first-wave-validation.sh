#!/usr/bin/env bash
set +e
: > first-wave-validation.txt

run_check() {
  name="$1"
  shift
  echo "===== $name =====" >> first-wave-validation.txt
  "$@" >> first-wave-validation.txt 2>&1
  code=$?
  echo "EXIT_CODE=$code" >> first-wave-validation.txt
  echo >> first-wave-validation.txt
}

run_check npm-ci npm ci
run_check lint npm run lint
run_check typecheck npx tsc --noEmit
run_check unit npm test
run_check build npm run build
run_check api npm run test:api

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add first-wave-validation.txt
git commit -m "chore: record first-wave validation" || true
git push origin HEAD:claude/crm-data-consistency-uoamow
