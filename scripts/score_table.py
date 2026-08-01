"""输出与游戏核心一致的 60 张牌四季评分表。"""

from __future__ import annotations

import argparse
import json

from simulator import SEASONS, calc_score, load_cards


def main() -> None:
    parser = argparse.ArgumentParser(description="甲子纪四季评分表")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()
    rows = [{"id": card.id, "name": card.name, **{season: calc_score(card, season) for season in SEASONS}}
            for card in load_cards()]
    if args.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    print("name\t" + "\t".join(SEASONS))
    for row in rows:
        print(row["name"] + "\t" + "\t".join(str(row[season]) for season in SEASONS))


if __name__ == "__main__":
    main()
