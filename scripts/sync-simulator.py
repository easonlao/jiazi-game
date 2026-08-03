"""
同步模拟器引擎到 repo/scripts/（供 CI 使用）。

docs/analysis/ 是模拟器的唯一真相源（不进 git），CI 只能拿到 repo/。
parity 测试需要调用 three_strategy_mix.py 的 trace 模式，因此将引擎复制到
repo/scripts/。改 docs/analysis/three_strategy_mix.py 后运行 npm run sync:simulator。

用法: python scripts/sync-simulator.py [--check]
  --check: 只校验两份是否一致，不一致时退出码 1（CI 用）
"""
import hashlib
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC = REPO_ROOT.parent / "docs" / "analysis" / "three_strategy_mix.py"
DST = REPO_ROOT / "scripts" / "three_strategy_mix.py"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    check_only = "--check" in sys.argv
    if not SRC.exists():
        print(f"[sync-simulator] ❌ 源文件不存在: {SRC}")
        return 1
    if check_only:
        if DST.exists() and sha256(SRC) == sha256(DST):
            print("[sync-simulator] ✓ 一致")
            return 0
        print(f"[sync-simulator] ❌ 不一致（docs 版 {sha256(SRC)[:8]} vs repo 版 {sha256(DST)[:8] if DST.exists() else '缺失'}）——请运行 npm run sync:simulator")
        return 1
    shutil.copy2(SRC, DST)
    print(f"[sync-simulator] ✓ 已同步 {SRC} → {DST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
