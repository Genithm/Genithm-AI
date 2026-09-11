from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PANEL = ROOT / "apps/web/app/dashboard/sequence-upload-panel.tsx"
STYLES = ROOT / "apps/web/app/dashboard/sequence-upload-panel.module.css"

panel = PANEL.read_text()
styles = STYLES.read_text()

required_panel = [
    'type UploadStage = "idle" | "reserving" | "uploading" | "queueing" | "queued";',
    'type FileReadiness = "idle" | "checking" | "ready" | "invalid";',
    'onDrop={(event) => {',
    'setStage("reserving")',
    'setStage("uploading")',
    'setStage("queueing")',
    'setStage("queued")',
    'role="alert"',
    'role="status"',
    'The browser only checks the basic FASTA envelope.',
]

for needle in required_panel:
    assert needle in panel, f"missing upload UX contract marker: {needle}"

assert "service_role" not in panel.lower()
assert "SUPABASE_SERVICE_ROLE" not in panel
assert ".dropzone" in styles
assert ".progressPanel" in styles
assert "prefers-reduced-motion" in styles

print("PASS: V1 sequence upload onboarding UI contract")
