"""Anaconda 由来の仮想環境で古い VC++ DLL が優先されるのを防ぐ。"""
import os
import sys

_runtime_handles = []


def prepare_windows_runtime():
    # Anaconda のファイルやシステムの設定は変更せず、このプロセスだけに適用する。
    if sys.platform != "win32" or not os.path.isdir(os.path.join(sys.base_prefix, "conda-meta")):
        return
    if _runtime_handles:
        return

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    get_system_directory = kernel32.GetSystemDirectoryW
    get_system_directory.argtypes = [wintypes.LPWSTR, wintypes.UINT]
    get_system_directory.restype = wintypes.UINT
    buffer = ctypes.create_unicode_buffer(32768)
    length = get_system_directory(buffer, len(buffer))
    if not length or length >= len(buffer):
        raise RuntimeError("Windows のシステム DLL フォルダを取得できません。")

    handles = []
    try:
        for name in ("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"):
            handles.append(ctypes.WinDLL(os.path.join(buffer.value, name)))
    except OSError as exc:
        raise RuntimeError(
            "Windows の Visual C++ ランタイムを読み込めません。"
            "Microsoft Visual C++ 再頒布可能パッケージ (x64) のインストール状態を確認してください。"
            f" 詳細: {exc}"
        ) from exc
    _runtime_handles.extend(handles)
