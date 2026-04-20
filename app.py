from __future__ import annotations

import argparse
from datetime import datetime
import os
from pathlib import Path
import tempfile

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = Path(
    os.getenv("TCM_HOME_CARE_DATA_DIR", Path(tempfile.gettempdir()) / "TCM_home_care")
)
OUTPUT_FILE = OUTPUT_DIR / "latest_run.txt"


def run_action(message: str, repeat_count: int) -> str:
    """執行示範動作，並將結果寫到 latest_run.txt。"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines = [
        f"[{timestamp}] 第 {index + 1} 次執行：{message}"
        for index in range(repeat_count)
    ]

    OUTPUT_DIR.mkdir(exist_ok=True)
    OUTPUT_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return "\n".join(lines)


def launch_gui() -> None:
    import tkinter as tk
    from tkinter import ttk

    root = tk.Tk()
    root.title("TCM Home Care")
    root.geometry("560x360")
    root.minsize(520, 320)

    frame = ttk.Frame(root, padding=20)
    frame.pack(fill="both", expand=True)

    title_label = ttk.Label(
        frame,
        text="TCM Home Care 執行面板",
        font=("Microsoft JhengHei UI", 18, "bold"),
    )
    title_label.pack(anchor="w")

    description_label = ttk.Label(
        frame,
        text="按下按鈕後會執行動作，並將最新結果輸出到系統暫存資料夾。",
        wraplength=500,
    )
    description_label.pack(anchor="w", pady=(8, 18))

    input_label = ttk.Label(frame, text="動作訊息")
    input_label.pack(anchor="w")

    message_var = tk.StringVar(value="預設動作已完成")
    message_entry = ttk.Entry(frame, textvariable=message_var)
    message_entry.pack(fill="x", pady=(6, 14))

    status_var = tk.StringVar(value="尚未執行")
    status_label = ttk.Label(frame, textvariable=status_var, foreground="#0F6CBD")
    status_label.pack(anchor="w", pady=(0, 10))

    result_box = tk.Text(frame, height=9, wrap="word")
    result_box.pack(fill="both", expand=True, pady=(0, 14))
    result_box.insert("1.0", "等待執行...")
    result_box.configure(state="disabled")

    def on_run_click() -> None:
        message = message_var.get().strip() or "預設動作已完成"
        result = run_action(message=message, repeat_count=1)
        status_var.set(f"執行完成，結果已寫入 {OUTPUT_FILE}")
        result_box.configure(state="normal")
        result_box.delete("1.0", "end")
        result_box.insert("1.0", result)
        result_box.configure(state="disabled")

    run_button = ttk.Button(frame, text="執行動作", command=on_run_click)
    run_button.pack(anchor="e")

    root.mainloop()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="TCM Home Care 專案示範程式")
    parser.add_argument(
        "--cli",
        action="store_true",
        help="使用命令列模式執行，適合 GitHub Actions。",
    )
    parser.add_argument(
        "--message",
        default="GitHub Actions 手動執行完成",
        help="執行時要寫入結果的訊息。",
    )
    parser.add_argument(
        "--repeat-count",
        type=int,
        default=1,
        help="要重複執行幾次，最小值為 1。",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repeat_count = max(args.repeat_count, 1)

    if args.cli:
        print(run_action(message=args.message, repeat_count=repeat_count))
        return

    launch_gui()


if __name__ == "__main__":
    main()
