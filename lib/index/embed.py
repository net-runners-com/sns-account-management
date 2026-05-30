"""埋め込み生成。bge-m3 / 静的埋め込みを同じインターフェースで扱う。"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
import config


class Embedder:
    def __init__(self, model_name: str | None = None):
        from sentence_transformers import SentenceTransformer
        self.model_name = model_name or config.EMBED_MODEL
        self.model = SentenceTransformer(self.model_name)
        self.dim = (
            self.model.get_embedding_dimension()
            if hasattr(self.model, "get_embedding_dimension")
            else self.model.get_sentence_embedding_dimension()
        )

    def embed(self, texts):
        if isinstance(texts, str):
            texts = [texts]
        vecs = self.model.encode(
            texts,
            normalize_embeddings=True,   # cosine 距離前提で正規化
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return [np.asarray(v, dtype=np.float32) for v in vecs]
