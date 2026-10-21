"""Camie / PixAI を共通 JSON-lines プロトコルで公開する。"""
import contextlib
import json
import os
import sys


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    output = sys.stdout

    def send(value):
        print(json.dumps(value, ensure_ascii=False), file=output, flush=True)

    try:
        config = json.loads(sys.stdin.readline())
        with contextlib.redirect_stdout(sys.stderr):
            if config["model"] == "camie":
                from camie import load_metadata, create_session, preprocess_image, run_inference
                root = config["camiePath"]
                idx, categories, _, size = load_metadata(os.path.join(root, "camie-tagger-v2-metadata.json"))
                session, input_name, provider = create_session(os.path.join(root, "camie-tagger-v2.onnx"))

                def infer(path):
                    tags, _ = run_inference(session, input_name, preprocess_image(path, size), idx, categories,
                                            min(config["characterThreshold"], config["copyrightThreshold"]), 70527)
                    return {key: [t for t in tags.get(key, []) if t["confidence"] >= config[key + "Threshold"]]
                            for key in ("character", "copyright")}
            else:
                from transformers import pipeline
                import torch
                from PIL import Image, ImageOps
                model_id = config["pixaiPath"] or "pixai-labs/pixai-tagger-v1.0"
                tagger = pipeline(model=model_id, image_processor=model_id, trust_remote_code=True,
                                  device=0 if torch.cuda.is_available() else -1)

                def infer(path):
                    with Image.open(path) as image:
                        results = tagger(ImageOps.exif_transpose(image).convert("RGB"), threshold={
                            "character": config["characterThreshold"], "copyright": config["copyrightThreshold"]})["results"]
                    return {key: [{"tag": tag, "confidence": float(score)} for tag, score in results.get(key, {}).items()]
                            for key in ("character", "copyright")}
        send({"ready": True})
        for line in sys.stdin:
            request = json.loads(line)
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    tags = infer(request["path"])
                send({"id": request["id"], "tags": tags})
            except Exception as exc:
                send({"id": request["id"], "error": str(exc)})
    except Exception as exc:
        send({"error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
