# Charassify

English | [日本語](README-ja.md)

A character illustration classification plugin for Eagle. Built on the image retrieval and Camie inference code from `eagle-ct_classifier`, it separates model selection, name mapping, review, and saving into distinct steps.

## Features

- Analyze selected images or all unfiled images in the library.
- Choose Camie Tagger v2, PixAI Tagger v1.0, or both.
- Merge tags from multiple models and show their sources and highest confidence scores.
- Use an LLM to translate character and series names into your chosen language, prioritizing existing folders.
- Map outfit variants to the same base character and deduplicate classification destinations.
- Approve or reject individual images, add or remove destinations, filter results, and approve visible results in bulk.
- Classify only approved images while preserving their existing folder memberships.
- Optionally create `Series name / Character name` folders when classification runs.
- Search, edit, and delete cached mappings, stored separately for each library path and language.
- Use cached mappings first and continue to review with saved mappings if the LLM fails.

“Unfiled” refers to Eagle's built-in unfiled state (`isUnfiled`), not a regular folder named “Unfiled.”

## Setup

1. Create a virtual environment with Python 3.10 or later and install the dependencies. On Windows:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

2. If using Camie, download the following files from [Camie Tagger v2](https://huggingface.co/Camais03/camie-tagger-v2/tree/main) and place them in the plugin's `models/` directory. The default setting is `models`. Relative paths resolve from the plugin directory; leaving the field blank also uses the default. You can specify an absolute path to another location. Only `models/.gitkeep` is tracked by Git; model files are excluded.
   - `camie-tagger-v2.onnx`
   - `camie-tagger-v2-metadata.json`
3. Use Eagle's plugin development menu to load the plugin containing this directory's `manifest.json`.
4. In Settings, check the Python executable and model locations. The default Python path is `.venv/Scripts/python.exe` on Windows and `.venv/bin/python` on macOS / Linux. Relative paths resolve from the plugin directory, so the virtual environment created in step 1 works directly. You can also specify an absolute path to another environment. An empty field uses the default; an explicit command name such as `python` or `python3` is resolved through PATH.
5. Enter the full endpoint URL of a Chat Completions-compatible LLM, its model ID, and an API key if required. Use HTTPS for cloud endpoints; HTTP is supported for local servers on localhost.
6. Set the output language and whether to allow new folders, then save.

PixAI uses the Transformers pipeline from the [official model](https://huggingface.co/pixai-labs/pixai-tagger-v1.0). With the default model ID, the model and code are downloaded on first use. It executes code from the official repository with `trust_remote_code=True`. You can also specify a local directory containing the complete downloaded model. Camie models are not downloaded automatically.

Because the official PixAI model is public, no Hugging Face authentication token is sent when downloading it. This allows loading even if a token saved for another purpose has expired. Other model IDs use the existing authentication configuration.

Models are not bundled. GPU use requires PyTorch / CUDA versions appropriate for your environment. Camie uses CPU inference by default; to use a GPU, install a compatible `onnxruntime-gpu` instead of `onnxruntime`. When using both models, each model's process exits before the next starts, so both models are never held in memory at once.

On Windows, virtual environments derived from Anaconda may prioritize older Visual C++ DLLs, causing `WinError 1114` when PyTorch loads `c10.dll`. When Charassify detects this environment, it preloads the Visual C++ runtime from the Windows system directory within the inference process. It does not modify Anaconda or system DLL files.

## Usage

1. Select the images to analyze and the model, then click **Start analysis** (`解析を開始`).
2. Review each image's tags, scores, and destinations. You can manually add destinations for images without mappings.
3. In the destination field, select the full path of an existing folder or enter a new `Series name/Character name` path.
4. Approve or reject each image. Changing its destinations resets it to pending review.
5. Click **Classify approved items** (`承認済みを分類`) to save. New folders are also created at this stage.

Unknown or invalid LLM mappings are not saved. New folders are never created when the series is unknown. If multiple folders share the same name, the plugin does not automatically choose the first match; you can select a specific folder ID in the mapping table.

In **Name mappings** (`名前の対応表`), you can correct character names, series names, and existing destinations. Choosing **Match by name / Create new** (`名前から照合 / 新規作成`) removes the fixed folder ID. Give outfit variants the same name and destination. Changes take effect on the next analysis. Deleting a mapping does not affect Eagle folders or items.

The LLM infers which outfit variants belong to the same character. It cannot guarantee correct identification of unknown characters or different characters with the same name. Review detections and proposed destinations before approving them.

## Data and error handling

- Images are processed locally in Python. Images are not sent to the LLM.
- The LLM receives character and series tags, existing folder names, hierarchy and IDs, and cached mappings for the same library and language.
- Settings, mappings, and API keys are stored in the plugin's `localStorage`. API keys are stored without encryption and restored on the next launch. To remove a key, clear the API key field in Settings and save. Edits made before switching tabs without saving are not persisted.
- Cancelling analysis discards partial results. The cancel button is hidden during name mapping and classification saving.
- If one model fails, you can still review the other model's results. Errors are shown per image.
- Name mapping uses batches of 30 tags with a 90-second timeout. Model initialization has a 10-minute timeout, and image inference has a 3-minute timeout.
- Targets are fetched again immediately before saving. If the library has changed since analysis, writing stops.
- Save failures are shown per image. Failed items can be retried without saving successful items again.
- Eagle's API does not provide transactions across multiple operations, so newly created empty folders may remain if saving an item fails.
- Supported inputs include PNG, JPEG, WebP, and other images readable by Pillow. SVG is excluded. GIF uses the first frame; support for other formats depends on the Python environment.

## Development and validation

```powershell
npm test
python -m unittest discover -s tests -p "test_*.py"
python -m py_compile src/inference/worker.py src/inference/camie.py
```

The JavaScript code runs without external npm dependencies and uses syntax and APIs available in Eagle's Node.js 16 / Chromium 107 environment. Tests mock the Eagle API and LLM. Real models, real LLMs, and the UI and classification behavior inside Eagle require separate manual verification.

```text
src/app.js               UI, analysis workflow, and review
src/core.js              Cache, destination resolution, and saving approved items
src/mapping.js           LLM name mapping and cache-first processing
src/eagle/items.js       Image retrieval inherited from the original plugin
src/inference/bridge.js  Python process management
src/inference/worker.py  Shared interface for individual models
src/inference/camie.py   Camie inference inherited from the original plugin
tests/run.js             Tests without real models or LLMs
```

Model references: [Camie](https://huggingface.co/Camais03/camie-tagger-v2), [PixAI](https://huggingface.co/pixai-labs/pixai-tagger-v1.0). Eagle API: [folder](https://developer.eagle.cool/plugin-api/api/folder), [library](https://developer.eagle.cool/plugin-api/api/library). Use models and model code in accordance with their providers' licenses.
