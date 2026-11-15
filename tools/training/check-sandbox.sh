#!/bin/sh
# Proves the network sandbox works on this machine before any training run is trusted: every kind of outside connection must
# fail inside it, a local socket must still work, and the training stack must still run. Exits non-zero on any surprise.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
probe="$(mktemp -d)/probe.mjs"
cat > "$probe" <<'JS'
try { await fetch('https://example.com'); console.log('LEAK node fetch'); process.exit(1); } catch { console.log('ok node fetch refused'); }
JS
fail=0
"$here/sandboxed.sh" node "$probe" | grep -q "ok node fetch refused" || { echo "FAIL: node fetch was not refused"; fail=1; }
"$here/sandboxed.sh" uv run --offline --project "$here" python - <<'PY' || fail=1
import socket, os, tempfile, urllib.request
def refused(fn, what):
    try:
        fn()
    except Exception:
        print("ok", what, "refused")
        return True
    print("LEAK", what)
    return False
good = refused(lambda: urllib.request.urlopen("https://example.com", timeout=5), "https request")
good &= refused(lambda: socket.create_connection(("1.1.1.1", 443), timeout=3), "raw ip connection")
good &= refused(lambda: socket.getaddrinfo("example.com", 443), "name lookup")
p = os.path.join(tempfile.mkdtemp(), "s")
a = socket.socket(socket.AF_UNIX); a.bind(p); a.listen(1)
b = socket.socket(socket.AF_UNIX); b.connect(p)
print("ok local socket works")
import torch
print("ok torch runs, mps:", torch.backends.mps.is_available())
raise SystemExit(0 if good else 1)
PY
[ "$fail" = 0 ] && echo "SANDBOX OK" || { echo "SANDBOX FAILED"; exit 1; }
