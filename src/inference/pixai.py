"""PixAI の公開モデルを、保存済みトークンの状態に依存せず読み込む。"""
import sys

PUBLIC_MODEL_ID = "pixai-labs/pixai-tagger-v1.0"


def load_tagger(model_id):
    from transformers import pipeline
    import torch

    # カスタム・非公開モデルには既存の Hugging Face 認証設定を適用する。
    auth = {"token": False} if model_id == PUBLIC_MODEL_ID else {}
    mps = getattr(getattr(torch, "backends", None), "mps", None)
    device = 0 if torch.cuda.is_available() else "mps" if mps and mps.is_available() else -1

    def create(target):
        result = pipeline(model=model_id, image_processor=model_id,
                          trust_remote_code=True, device=target, **auth)
        print(f"[PixAI] device={target}", file=sys.stderr, flush=True)
        return result

    try:
        tagger = create(device)
    except (RuntimeError, NotImplementedError):
        if device == -1:
            raise
        print("[PixAI] GPU initialization failed; retrying on CPU", file=sys.stderr, flush=True)
        device = -1
        tagger = create(device)

    def infer(*args, **kwargs):
        nonlocal tagger, device
        try:
            return tagger(*args, **kwargs)
        except (RuntimeError, NotImplementedError):
            if device == -1:
                raise
        # Leave the exception handler before releasing GPU memory and loading again.
        print("[PixAI] GPU inference failed; retrying on CPU", file=sys.stderr, flush=True)
        tagger = None
        if device == 0:
            torch.cuda.empty_cache()
        elif device == "mps":
            torch.mps.empty_cache()
        device = -1
        tagger = create(device)
        return tagger(*args, **kwargs)

    return infer
