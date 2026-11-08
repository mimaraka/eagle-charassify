"""ダウンロードせずに公開モデルの認証とデバイス選択を検証する。"""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "inference"))
from pixai import load_tagger, PUBLIC_MODEL_ID


class PixaiTest(unittest.TestCase):
    def options(self, model_id, gpu=False, mps=False):
        pipeline = Mock()
        with patch.dict(sys.modules, {
            "transformers": SimpleNamespace(pipeline=pipeline),
            "torch": SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: gpu),
                                     backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: mps))),
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

    def test_mps_selection_and_cuda_priority(self):
        self.assertEqual(self.options(PUBLIC_MODEL_ID, mps=True)["device"], "mps")
        self.assertEqual(self.options(PUBLIC_MODEL_ID, gpu=True, mps=True)["device"], 0)

    def test_gpu_initialization_failure_retries_cpu(self):
        pipeline = Mock(side_effect=[RuntimeError("GPU unavailable"), Mock()])
        with patch.dict(sys.modules, {
            "transformers": SimpleNamespace(pipeline=pipeline),
            "torch": SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True)),
        }):
            load_tagger(PUBLIC_MODEL_ID)
        self.assertEqual([call.kwargs["device"] for call in pipeline.call_args_list], [0, -1])

    def test_gpu_inference_failure_switches_to_cpu_once(self):
        cpu = Mock(return_value={"results": {}})
        pipeline = Mock(side_effect=[Mock(side_effect=NotImplementedError("unsupported op")), cpu])
        with patch.dict(sys.modules, {
            "transformers": SimpleNamespace(pipeline=pipeline),
            "torch": SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, empty_cache=Mock())),
        }):
            infer = load_tagger(PUBLIC_MODEL_ID)
            self.assertEqual(infer("image"), {"results": {}})
            infer("another image")
        self.assertEqual(pipeline.call_count, 2)
        self.assertEqual(cpu.call_count, 2)

    def test_cpu_error_propagates(self):
        pipeline = Mock(side_effect=RuntimeError("broken model"))
        with patch.dict(sys.modules, {
            "transformers": SimpleNamespace(pipeline=pipeline),
            "torch": SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)),
        }):
            with self.assertRaisesRegex(RuntimeError, "broken model"):
                load_tagger(PUBLIC_MODEL_ID)
        self.assertEqual(pipeline.call_count, 1)


if __name__ == "__main__":
    unittest.main()
