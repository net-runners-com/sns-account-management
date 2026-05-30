"""検索精度の評価。gold.jsonl を使って Hit@k と MRR を、リランクON/OFFで比較する。"""
import sys
import os
import json

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # lib/index

import search  # noqa: E402

GOLD = os.path.join(HERE, "gold.jsonl")
KS = (1, 3, 5)
TOPN = 10


def load_gold():
    out = []
    with open(GOLD, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def first_relevant_rank(results, relevant):
    rel = set(relevant)
    for i, r in enumerate(results, 1):
        if r["path"] in rel:
            return i
    return None


def evaluate(gold, rerank):
    hits = {k: 0 for k in KS}
    mrr = 0.0
    for item in gold:
        res = search.search(item["q"], k=TOPN, rerank=rerank)
        rank = first_relevant_rank(res, item["relevant"])
        if rank:
            mrr += 1.0 / rank
            for k in KS:
                if rank <= k:
                    hits[k] += 1
    n = len(gold)
    return {f"Hit@{k}": hits[k] / n for k in KS} | {"MRR": mrr / n}


def main():
    gold = load_gold()
    print(f"gold queries: {len(gold)}\n")

    print("evaluating: hybrid のみ（リランクOFF）...")
    base = evaluate(gold, rerank=False)
    print("evaluating: hybrid + リランク（ON）...")
    rer = evaluate(gold, rerank=True)

    cols = ["Hit@1", "Hit@3", "Hit@5", "MRR"]
    print(f"\n{'metric':<8} {'hybrid':>9} {'+rerank':>9} {'Δ':>8}")
    print("-" * 38)
    for c in cols:
        d = rer[c] - base[c]
        print(f"{c:<8} {base[c]:>9.3f} {rer[c]:>9.3f} {d:>+8.3f}")


if __name__ == "__main__":
    main()
