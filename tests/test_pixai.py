"""ダウンロードせずに公開モデルの認証とデバイス選択を検証する。"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "inference"))
from pixai import load_tagger, PUBLIC_MODEL_ID


class PixaiTest(unittest.TestCase):
    def options(self, model_id, gpu=False):
        pipeline = Mock()
        with patch.dict(sys.modules, {
            "transformers": SimpleNamespace(pipeline=pipeline),
            "torch": SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: gpu)),
        }):
            load_tagger(model_id)
        return pipeline.call_args.kwargs

    def test_public_model_does_not_send_saved_token(self):
        options = self.options(PUBLIC_MODEL_ID)
        self.assertIs(options["token"], False)
        self.assertEqual(options["device"], -1)
        self.assertEqual(options["image_processor"], PUBLIC_MODEL_ID)

    def test_custom_model_keeps_default_auth(self):
        self.assertNotIn("token", self.options("someone/private-model"))

    def test_gpu_selection(self):
        self.assertEqual(self.options(PUBLIC_MODEL_ID, gpu=True)["device"], 0)


if __name__ == "__main__":
    unittest.main()
