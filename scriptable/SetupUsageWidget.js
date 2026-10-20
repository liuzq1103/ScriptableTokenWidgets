// SetupUsageWidget · ScriptableTokenWidgets · MIT
// Paste this entire script into Scriptable, then run it once.
const alert = new Alert();
alert.title = "连接你的用量";
alert.message = "先连接 Tailscale。输入 PC 上生成的服务地址与只读令牌。无需填写模型 API Key。";
alert.addTextField("http://你的 Tailscale IP:8799", "");
alert.addSecureTextField("只读访问令牌", "");
alert.addAction("验证并安装"); alert.addCancelAction("取消");
if (await alert.presentAlert() !== -1) {
  const baseURL = alert.textFieldValue(0).trim().replace(/\/+$/, "");
  const token = alert.textFieldValue(1).trim();
  try {
    if (!/^https?:\/\/[^/?#\s]+$/i.test(baseURL) || /@/.test(baseURL)) throw new Error("请输入完整服务地址，不含路径或登录信息。");
    const host = baseURL.replace(/^https?:\/\//i, "").split(":")[0].toLowerCase();
    const parts = host.split(".").map(Number);
    const tailnet = parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255);
    if (/^http:/i.test(baseURL) && !tailnet && host !== "localhost" && host !== "127.0.0.1" && !/\.ts\.net$/.test(host)) {
      throw new Error("HTTP 地址必须是 Tailscale 地址或本机回环地址。");
    }
    if (token.length < 32) throw new Error("令牌不完整，请复制 PC 上生成的完整只读令牌。");
    const probe = new Request(baseURL + "/api/v1/overview");
    probe.headers = { Authorization: "Bearer " + token }; probe.timeoutInterval = 12;
    const data = await probe.loadJSON();
    if (probe.response && probe.response.statusCode === 401) throw new Error("只读令牌无效。");
    if (data.schemaVersion !== 1) throw new Error("未识别到兼容服务，请检查地址与令牌。");
    const download = new Request(baseURL + "/scriptable/UsageWidget.js"); download.timeoutInterval = 12;
    const source = await download.loadString();
    if (!source.startsWith("// UsageWidget · ScriptableTokenWidgets") || !source.includes("Script.setWidget") || source.length > 100000) throw new Error("组件下载校验失败。");
    let fm;
    try { fm = FileManager.iCloud(); fm.documentsDirectory(); }
    catch { fm = FileManager.local(); }
    const target = fm.joinPath(fm.documentsDirectory(), "UsageWidget.js");
    if (fm.fileExists(target)) {
      if (fm.isFileStoredIniCloud(target)) await fm.downloadFileFromiCloud(target);
      if (!fm.readString(target).startsWith("// UsageWidget · ScriptableTokenWidgets")) throw new Error("已有同名脚本，请先重命名原脚本再安装。");
    }
    fm.writeString(target, source);
    Keychain.set("usage-bridge-v1", JSON.stringify({ baseURL, token }));
    const done = new Alert();
    done.title = "已连接";
    done.message = "UsageWidget 已安装。长按桌面添加 Scriptable 中号小组件，选择 UsageWidget。\n\n小号参数可填 codex、minimax 或 glm。再次运行本安装器可更新组件。";
    done.addAction("预览组件"); done.addCancelAction("完成");
    if (await done.presentAlert() !== -1) Safari.open("scriptable:///run?scriptName=UsageWidget");
  } catch (error) {
    const failed = new Alert();
    failed.title = "连接未完成";
    failed.message = String(error.message || "请检查 PC 服务和 Tailscale，再重试。");
    failed.addAction("知道了"); await failed.presentAlert();
  }
}
Script.complete();
