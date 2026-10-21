"""PixAI の公開モデルを、保存済みトークンの状態に依存せず読み込む。"""
PUBLIC_MODEL_ID = "pixai-labs/pixai-tagger-v1.0"


def load_tagger(model_id):
    from transformers import pipeline
    import torch

    # カスタム・非公開モデルには既存の Hugging Face 認証設定を適用する。
    auth = {"token": False} if model_id == PUBLIC_MODEL_ID else {}
    return pipeline(
        model=model_id,
        image_processor=model_id,
        trust_remote_code=True,
        device=0 if torch.cuda.is_available() else -1,
        **auth,
    )
