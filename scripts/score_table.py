"""输出与游戏核心一致的 60 张牌四季评分表。

基于 three_strategy_mix.py（评分逻辑与 JiaziCard.ts 逐条对齐，参数来自 balance_config.json），
替代已归档的 scripts/simulator.py 依赖。

运行: python scripts/score_table.py [--json]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "docs" / "analysis"))

import three_strategy_mix as m


def main() -> None:
    parser = argparse.ArgumentParser(description="甲子纪四季评分表")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()
    rows = [{"id": card["id"], "name": card["name"],
             **{season: m.get_score(card, season) for season in m.SEASONS}}
            for card in m.CARDS]
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    print("name\t" + "\t".join(m.SEASONS))
    for row in rows:
        print(row["name"] + "\t" + "\t".join(str(row[season]) for season in m.SEASONS))


if __name__ == "__main__":
    main()
