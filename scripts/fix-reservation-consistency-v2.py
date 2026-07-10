from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "lib/patientSummary.ts"
text = path.read_text()
old = '''  const depositDelta = (afterActive ? parseAmount(mutation.after.depositAmount) : 0)
    - (beforeActive ? parseAmount(mutation.before.depositAmount) : 0);
  const surgeryDelta = (afterActive ? parseAmount(mutation.after.surgeryCost) : 0)
    - (beforeActive ? parseAmount(mutation.before.surgeryCost) : 0);
'''
new = '''  const beforeRecord = beforeActive ? mutation.before : null;
  const afterRecord = afterActive ? mutation.after : null;
  const depositDelta = parseAmount(afterRecord?.depositAmount)
    - parseAmount(beforeRecord?.depositAmount);
  const surgeryDelta = parseAmount(afterRecord?.surgeryCost)
    - parseAmount(beforeRecord?.surgeryCost);
'''
if text.count(old) != 1:
    raise RuntimeError(f"incremental null-safety patch: expected one match, got {text.count(old)}")
path.write_text(text.replace(old, new, 1))
print("reservation consistency v2 null-safety fix applied")
