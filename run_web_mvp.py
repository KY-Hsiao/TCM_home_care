from __future__ import annotations

import shutil
import socket
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
VERIFY_DIR = Path(r"C:\codex-deps\tcm-home-care-verify")
BACKUP_NODE_MODULES = Path(r"C:\codex-deps\tcm-home-care\node_modules")
SYNC_DIRECTORIES = ("src", "public", "legacy-python", ".vscode")
SYNC_FILES = (
    "package.json",
    "index.html",
    "tsconfig.json",
    "vite.config.ts",
    "tailwind.config.ts",
    "postcss.config.js",
    "eslint.config.js",
    "README.md",
)


def has_usable_node_modules(root: Path) -> bool:
    required_files = [
        root / "node_modules" / "react" / "package.json",
        root / "node_modules" / "typescript" / "package.json",
        root / "node_modules" / "vite" / "package.json",
    ]
    for file_path in required_files:
        if not file_path.exists():
            return False
        if file_path.stat().st_size <= 0:
            return False
    return True


def ensure_verification_workspace(source_root: Path) -> Path:
    if not BACKUP_NODE_MODULES.exists():
        raise RuntimeError(
            f"找不到備援依賴樹：{BACKUP_NODE_MODULES}。"
            "請先執行 powershell -ExecutionPolicy Bypass -File .\\.codex\\scripts\\setup.ps1"
        )

    VERIFY_DIR.mkdir(parents=True, exist_ok=True)

    print("目前專案位於雲端同步或受限路徑，將同步到本機驗證副本後啟動...")
    for relative_path in SYNC_DIRECTORIES:
        source_path = source_root / relative_path
        target_path = VERIFY_DIR / relative_path
        if source_path.exists():
            shutil.copytree(source_path, target_path, dirs_exist_ok=True)

    for relative_path in SYNC_FILES:
        source_path = source_root / relative_path
        target_path = VERIFY_DIR / relative_path
        if source_path.exists():
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, target_path)

    verify_node_modules = VERIFY_DIR / "node_modules"
    verify_vite_cmd = verify_node_modules / ".bin" / "vite.cmd"
    if verify_vite_cmd.exists():
        return VERIFY_DIR

    if verify_node_modules.exists():
        remove_link_result = subprocess.run(
            ["cmd", "/c", "rmdir", str(verify_node_modules)],
            check=False,
        )
        if remove_link_result.returncode != 0 and verify_node_modules.exists():
            shutil.rmtree(verify_node_modules)

    subprocess.run(
        [
            "cmd",
            "/c",
            "mklink",
            "/J",
            str(verify_node_modules),
            str(BACKUP_NODE_MODULES),
        ],
        check=True,
    )
    return VERIFY_DIR


def resolve_run_root() -> Path:
    if has_usable_node_modules(BASE_DIR):
        return BASE_DIR
    return ensure_verification_workspace(BASE_DIR)


def resolve_vite_command(run_root: Path) -> list[str]:
    vite_cmd = run_root / "node_modules" / ".bin" / "vite.cmd"
    if vite_cmd.exists():
        return [str(vite_cmd)]

    npm_cmd = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm_cmd:
        raise RuntimeError("找不到 npm，請先安裝 Node.js 並執行 npm install。")

    subprocess.run([npm_cmd, "install"], cwd=run_root, check=True)

    if not vite_cmd.exists():
        raise RuntimeError(f"已執行 npm install，但仍找不到 {vite_cmd}")

    return [str(vite_cmd)]


def port_is_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def resolve_vite_port(preferred_port: int = 5173) -> int:
    for candidate_port in range(preferred_port, preferred_port + 21):
        if port_is_available(candidate_port):
            return candidate_port
    raise RuntimeError(f"找不到可用的 Vite port（{preferred_port} ~ {preferred_port + 20}）。")


def main() -> None:
    print("目前專案主入口是 React Web MVP，正在啟動 Vite 開發伺服器...")
    print("若你要開舊版 Python / Tkinter 示範，請改跑 legacy-python/app.py。")
    run_root = resolve_run_root()
    print(f"Web MVP 啟動路徑：{run_root}")
    command = resolve_vite_command(run_root)
    selected_port = resolve_vite_port()
    if selected_port != 5173:
        print(f"Port 5173 已被占用，改用 port {selected_port} 啟動。")
    command.extend(["--host", "127.0.0.1", "--port", str(selected_port), "--open", "--strictPort"])
    subprocess.run(command, cwd=run_root, check=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as error:
        print(f"啟動失敗：{error}", file=sys.stderr)
        sys.exit(1)
