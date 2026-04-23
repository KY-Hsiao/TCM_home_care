from __future__ import annotations

import argparse
import json
import subprocess
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
AUTOMATION_SCRIPT = SCRIPT_DIR / "open_line_chat.ps1"


def build_result(
    *,
    success: bool,
    stage: str,
    message: str,
    fallback_recommended: bool,
) -> dict[str, Any]:
    return {
        "success": success,
        "stage": stage,
        "message": message,
        "fallbackRecommended": fallback_recommended,
    }


def run_line_automation(payload: dict[str, Any]) -> dict[str, Any]:
    if sys.platform != "win32":
        return build_result(
            success=False,
            stage="fallback",
            message="桌面 LINE helper 目前只支援 Windows。",
            fallback_recommended=True,
        )

    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(AUTOMATION_SCRIPT),
        "-DoctorId",
        str(payload.get("doctorId", "")),
        "-DoctorName",
        str(payload.get("doctorName", "")),
        "-LineSearchKeyword",
        str(payload.get("lineSearchKeyword", "")),
        "-Phone",
        str(payload.get("phone", "")),
        "-LineWindowHint",
        str(payload.get("lineWindowHint", "")),
    ]
    if payload.get("launchLineIfNeeded"):
        command.append("-LaunchLineIfNeeded")

    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )

    stdout = completed.stdout.strip()
    stderr = completed.stderr.strip()
    raw_output = stdout or stderr
    if completed.returncode != 0:
        return build_result(
            success=False,
            stage="fallback",
            message=raw_output or "桌面 LINE helper 執行失敗。",
            fallback_recommended=True,
        )

    try:
        parsed = json.loads(raw_output)
    except json.JSONDecodeError:
        return build_result(
            success=False,
            stage="fallback",
            message=raw_output or "桌面 LINE helper 回傳格式不正確。",
            fallback_recommended=True,
        )

    return {
      "success": bool(parsed.get("success")),
      "stage": parsed.get("stage", "helper_request"),
      "message": parsed.get("message", "已送出 LINE 對話切換要求。"),
      "fallbackRecommended": parsed.get(
          "fallbackRecommended", not bool(parsed.get("success"))
      ),
    }


class LineHelperHandler(BaseHTTPRequestHandler):
    server_version = "TCMLineHelper/0.1"

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "message": "LINE helper ready"
                },
            )
            return

        self._send_json(
            HTTPStatus.NOT_FOUND,
            {
                "status": "not_found"
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/line/open-chat":
            self._send_json(
                HTTPStatus.NOT_FOUND,
                build_result(
                    success=False,
                    stage="fallback",
                    message="找不到指定的 helper API。",
                    fallback_recommended=True,
                ),
            )
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                build_result(
                    success=False,
                    stage="validate_request",
                    message="LINE helper 收到無法解析的 JSON。",
                    fallback_recommended=True,
                ),
            )
            return

        result = run_line_automation(payload)
        self._send_json(HTTPStatus.OK, result)

    def log_message(self, format: str, *args: Any) -> None:
        sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="TCM home care LINE desktop helper")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), LineHelperHandler)
    print(f"LINE helper listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("LINE helper stopped")
        return 130
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
