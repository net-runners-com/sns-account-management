"""cross-encoder リランカー（bge-reranker-v2-m3）。候補を本当の関連度で並べ直す。"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config


class Reranker:
    def __init__(self, model_name: str | None = None):
        from sentence_transformers import CrossEncoder
        self.model_name = model_name or config.RERANK_MODEL
        self.model = CrossEncoder(self.model_name)

    def score(self, query: str, passages):
        if not passages:
            return []
        pairs = [(query, p) for p in passages]
        scores = self.model.predict(pairs)
        return [float(s) for s in scores]
