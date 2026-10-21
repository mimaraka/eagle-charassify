# Charassify

Eagle 用のキャラクターイラスト分類プラグインです。`eagle-ct_classifier` の画像取得・Camie 推論を基に、モデル選択、名前の対応付け、確認、保存を分離して再設計しています。

## できること

- 選択中の画像／ライブラリの「未分類」画像全体を解析
- Camie Tagger v2／PixAI Tagger v1.0／両方を選択
- 複数モデルのタグを統合し、検出元と最大スコアを表示
- LLM でキャラクター名・作品名を指定言語へ変換、既存フォルダを優先
- 衣装差分を同じ基本キャラクターへ対応付け、同じ分類先を重複排除
- 画像ごとの承認・却下・分類先の追加／削除、絞り込み、一括承認
- 承認済みの画像のみ分類。既存の所属フォルダは保持
- 新規作成を有効にすると「作品名 / キャラクター名」を分類実行時に作成
- ライブラリのパス・言語ごとの対応キャッシュ。検索・編集・削除が可能
- キャッシュを先に使用。LLM の失敗時も保存済みの対応でレビューへ進む

「未分類」は Eagle の組み込み未分類状態（`isUnfiled`）です。「未分類」という名前の通常フォルダではありません。

## セットアップ

1. Python 3.10 以降で仮想環境を作成し、依存を導入します。Windows の例:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

2. [Camie Tagger v2](https://huggingface.co/Camais03/camie-tagger-v2/tree/main) から次のファイルをプラグイン内の `models/` へ配置します（Camie を使う場合）。設定の既定値は `models` です。相対パスはプラグインのフォルダを基準に解決し、空欄でも既定値を使用します。別の場所の絶対パスも指定できます。`models/.gitkeep` のみ Git 管理し、モデルファイルは管理対象から除外します。
   - `camie-tagger-v2.onnx`
   - `camie-tagger-v2-metadata.json`
3. Eagle のプラグイン開発メニューで、このディレクトリの `manifest.json` を含むプラグインを読み込みます。
4. 設定画面で Python 実行ファイルとモデルの場所を確認します。Python の既定値は Windows で `.venv/Scripts/python.exe`、macOS / Linux で `.venv/bin/python` です。相対パスはプラグインのフォルダを基準に解決するため、手順1で作成した仮想環境をそのまま使用できます。別の仮想環境の絶対パスも指定できます。空欄は既定値として扱い、`python` / `python3` のようなコマンド名だけを明示指定した場合は PATH から探します。
5. Chat Completions 互換 LLM の完全な接続先 URL、モデル ID、必要なら API キーを指定します。クラウドには HTTPS、ローカルサーバーには localhost の HTTP を利用できます。
6. 出力言語・新規フォルダ作成の有無を設定し、保存します。

PixAI は [公式モデル](https://huggingface.co/pixai-labs/pixai-tagger-v1.0) の Transformers pipeline を利用します。既定のモデル ID では初回にモデルとコードがダウンロードされます。`trust_remote_code=True` で公式リポジトリのコードを実行します。ダウンロード済みのモデル一式を含むローカルフォルダも指定できます。Camie のモデルは自動ダウンロードしません。

公式 PixAI モデルは公開されているため、取得時に Hugging Face の認証トークンを送信しません。これにより、別の用途で保存されたトークンが期限切れでも読み込めます。別のモデル ID を指定した場合は既存の認証設定を使用します。

モデルは同梱していません。GPU の利用には環境に合った PyTorch / CUDA が必要です。Camie は標準構成で CPU 推論を利用します。GPU を使う場合は `onnxruntime` の代わりに対応する `onnxruntime-gpu` を導入してください。両モデル併用時はモデルごとにプロセスを終了してから次を起動し、モデルを同時にメモリへ保持しません。

Windows で Anaconda 由来の仮想環境を使う場合、古い Visual C++ DLL が優先され、PyTorch の `c10.dll` 読み込みで `WinError 1114` が発生することがあります。Charassify はこの環境を検出すると、Windows のシステムフォルダにある Visual C++ ランタイムを推論プロセス内で先に読み込みます。Anaconda 本体やシステムの DLL ファイルは変更しません。

## 使い方

1. 解析対象とモデルを選び「解析を開始」。
2. 各画像のタグ・スコア・分類先を確認します。未マッピングの画像にも分類先を手動追加できます。
3. 分類先入力では既存フォルダの完全なパスを選択するか、新規の `作品名/キャラクター名` を入力します。
4. 各画像を承認／却下します。分類先を変更すると未確認へ戻ります。
5. 「承認済みを分類」で保存します。新規フォルダもこの段階で作成します。

LLM の応答が不明・不正な場合はその対応を保存しません。作品が不明なままフォルダを新規作成することもありません。同名フォルダが複数ある場合は自動で最初の候補を選ばず、対応表のフォルダ選択で ID を指定できます。

「名前の対応表」でキャラクター名・作品名・既存分類先を訂正できます。「名前から照合 / 新規作成」を選ぶと既存 ID の固定を解除します。衣装差分には同じ名前と分類先を指定してください。変更は次の解析に適用されます。対応表の削除は Eagle のフォルダ・アイテムには影響しません。

LLM による衣装差分の統合は意味推定です。未知のキャラクターや同名の別人を常に正確に判定できる保証はありません。検出結果と提案先を確認してから承認してください。

## データとエラー処理

- 画像はローカル Python で処理します。LLM へ画像は送信しません。
- LLM へ送る情報は、キャラクター／作品タグ、既存フォルダの名前・階層・ID、同じライブラリと言語の対応キャッシュです。
- 設定・キャッシュ・API キーはプラグインの `localStorage` に保存します。API キーは暗号化せず保存し、次回起動時に復元します。削除する場合は設定画面で API キーを空欄にして保存してください。保存せずに別のタブへ移動した変更は保存されません。
- 解析を中止すると部分結果を破棄します。名前変換・分類保存の段階では中止ボタンを表示しません。
- モデルの一方が失敗した場合も、もう一方の結果をレビューできます。画像ごとのエラーを表示します。
- 名前変換は30タグ単位、90秒のタイムアウトです。モデル初期化は10分、画像推論は3分のタイムアウトです。
- 保存直前に対象を再取得し、解析後のライブラリ切替を検出すると書き込みを停止します。
- 保存失敗は画像ごとに表示し、成功分を再保存せず失敗分を再試行できます。
- Eagle API に複数操作のトランザクションはないため、アイテム保存失敗時に作成済みの空フォルダが残る場合があります。
- PNG、JPEG、WebP など Pillow が読み込める画像が対象です。SVG は対象外です。GIF は先頭フレーム、その他の形式は Python 環境の対応状況に依存します。

## 開発・検証

```powershell
npm test
python -m unittest discover -s tests -p "test_*.py"
python -m py_compile src/inference/worker.py src/inference/camie.py
```

JavaScript は外部 npm 依存なしで動作します。Eagle の Node.js 16 / Chromium 107 で利用できる構文・API を使用しています。テストの Eagle API と LLM はモックです。実モデル・実 LLM・Eagle 上での画面表示と分類は別途実機確認が必要です。

```
src/app.js               画面、解析の進行、レビュー
src/core.js              キャッシュ、分類先解決、承認後の保存
src/mapping.js           LLM の名前変換とキャッシュ優先処理
src/eagle/items.js       既存プラグインから継承した画像取得
src/inference/bridge.js  Python プロセス管理
src/inference/worker.py  モデルごとの共通インターフェース
src/inference/camie.py   既存プラグインから継承した Camie 推論
tests/run.js             モデル・LLM を使わない動作テスト
```

モデル仕様の確認元: [Camie](https://huggingface.co/Camais03/camie-tagger-v2)、[PixAI](https://huggingface.co/pixai-labs/pixai-tagger-v1.0)。Eagle API: [folder](https://developer.eagle.cool/plugin-api/api/folder)、[library](https://developer.eagle.cool/plugin-api/api/library)。モデル・モデルコードの利用条件は各提供元のライセンスに従ってください。
