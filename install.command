#!/usr/bin/env bash
# macOS: Finderでこのファイルをダブルクリックするとインストールが始まります。
# （初回はGatekeeperの警告が出る場合あり → 右クリック→「開く」で許可）
cd "$(dirname "$0")"
echo "== sns-account-management インストーラ =="
echo
bash setup.sh
status=$?
echo
if [ $status -eq 0 ]; then
  echo "✅ 完了しました。このウィンドウは閉じて構いません。"
else
  echo "⚠️ エラーで終了しました（上のログを確認してください）。"
fi
echo "Enterキーで閉じる…"
read -r
