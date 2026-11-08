"""GPU hardware and model downloads are not required for backend selection tests."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "inference"))
import camie


class CamieTest(unittest.TestCase):
    def run_session(self, available, failures=(), silent=()):
        def create(path, sess_options, providers):
            selected = providers[0]
            if selected in failures:
                raise RuntimeError("backend failed")
            active = ["CPUExecutionProvider"] if selected in silent else providers
            return SimpleNamespace(get_providers=lambda: active,
                                   get_inputs=lambda: [SimpleNamespace(name="input")])
        ort = SimpleNamespace(get_available_providers=lambda: available,
                              SessionOptions=SimpleNamespace,
                              ExecutionMode=SimpleNamespace(ORT_SEQUENTIAL="sequential"),
                              InferenceSession=Mock(side_effect=create))
        with patch.dict(sys.modules, {"onnxruntime": ort}), patch.object(camie, "_register_cuda_dll_dirs"):
            result = camie.create_session("model.onnx")
        return result, ort.InferenceSession

    def test_cpu_only(self):
        result, _ = self.run_session(["CPUExecutionProvider"])
        self.assertEqual(result[2], "CPUExecutionProvider")

    def test_each_gpu_backend(self):
        for backend in ("CUDAExecutionProvider", "CoreMLExecutionProvider", "DmlExecutionProvider"):
            with self.subTest(backend=backend):
                result, factory = self.run_session([backend, "CPUExecutionProvider"])
                self.assertEqual(result[2], backend)
                self.assertEqual(factory.call_args.kwargs["providers"], [backend, "CPUExecutionProvider"])
                if backend == "DmlExecutionProvider":
                    options = factory.call_args.kwargs["sess_options"]
                    self.assertFalse(options.enable_mem_pattern)
                    self.assertEqual(options.execution_mode, "sequential")

    def test_failure_and_silent_fallback_try_next_gpu(self):
        for key in ("failures", "silent"):
            result, factory = self.run_session(
                ["DmlExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"],
                **{key: ["CUDAExecutionProvider"]})
            self.assertEqual(result[2], "DmlExecutionProvider")
            self.assertEqual(factory.call_count, 2)

    def test_gpu_failure_uses_cpu(self):
        result, _ = self.run_session(["CoreMLExecutionProvider"], failures=["CoreMLExecutionProvider"])
        self.assertEqual(result[2], "CPUExecutionProvider")

    def test_cpu_failure_propagates(self):
        with self.assertRaisesRegex(RuntimeError, "backend failed"):
            self.run_session([], failures=["CPUExecutionProvider"])
