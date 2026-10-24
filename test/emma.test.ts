import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildEmmaPayload, callEmma, emmaApiKey, signEmma } from "../src/emma.ts";
import test from "./context.ts";

test("signEmma 输出稳定的小写十六进制签名", () => {
  const first = signEmma("1700000000", '{"a":1}', "k");
  const second = signEmma("1700000000", '{"a":1}', "k");
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, signEmma("1700000001", '{"a":1}', "k"));
});

test("buildEmmaPayload 按官方字段组装并截断文本", () => {
  const payload = buildEmmaPayload({
    userId: "u1",
    billType: "expense",
    text: "x".repeat(5000),
    categories: [{ name: "三餐", subs: ["午餐"] }],
    assets: [["微信", "CNY"]],
  });
  assert.equal(payload.userId, "u1");
  assert.equal(payload.bookId, -1);
  assert.equal(payload.billType, "expense");
  assert.equal(String(payload.text).length, 4096);
  assert.deepEqual(payload.categories, [{ name: "三餐", subs: ["午餐"] }]);
  assert.deepEqual(payload.assets, [["微信", "CNY"]]);
  assert.equal("duration" in payload, false);
});

test("buildEmmaPayload 在提供 duration 时带上该字段", () => {
  const payload = buildEmmaPayload({
    userId: "u1",
    billType: "expense",
    text: "小票",
    categories: [],
    assets: [],
    duration: 1200,
  });
  assert.equal(payload.duration, 1200);
});

test("emmaApiKey 未配置时返回空串", () => {
  const savedEnv = process.env.EMMA_API_KEY;
  const savedFile = process.env.EMMA_KEY_FILE;
  delete process.env.EMMA_API_KEY;
  process.env.EMMA_KEY_FILE = "/nonexistent/.emma-key";
  try {
    assert.equal(emmaApiKey(), "");
  } finally {
    if (savedEnv === undefined) delete process.env.EMMA_API_KEY;
    else process.env.EMMA_API_KEY = savedEnv;
    if (savedFile === undefined) delete process.env.EMMA_KEY_FILE;
    else process.env.EMMA_KEY_FILE = savedFile;
  }
});

function stubFetch(responder: (url: string, init: RequestInit) => Response): { calls: Array<{ url: string; init: RequestInit }>; restore: () => void } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("callEmma 发送签名头并返回解析后的 JSON", async () => {
  const saved = process.env.EMMA_API_KEY;
  process.env.EMMA_API_KEY = "test-key";
  const stub = stubFetch(() => new Response(JSON.stringify({ category_name: "三餐", amount: 15 }), { status: 200 }));
  try {
    const out = await callEmma("a11y2billv2", { userId: "u1", text: "猪脚饭 15 元" });
    assert.deepEqual(out, { category_name: "三餐", amount: 15 });
    const [call] = stub.calls;
    assert.equal(call.url, "https://api.qianjiapp.com/emmav2/a11y2billv2");
    assert.equal(call.init.method, "POST");
    const headers = call.init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "test-key");
    const body = String(call.init.body);
    assert.equal(headers["x-signature"], signEmma(headers["x-timestamp"], body));
  } finally {
    stub.restore();
    if (saved === undefined) delete process.env.EMMA_API_KEY;
    else process.env.EMMA_API_KEY = saved;
  }
});

test("callEmma 在 HTTP 错误时返回 error 与 detail", async () => {
  const saved = process.env.EMMA_API_KEY;
  process.env.EMMA_API_KEY = "test-key";
  const stub = stubFetch(() => new Response(JSON.stringify({ message: "quota exceeded" }), { status: 429 }));
  try {
    const out = await callEmma("ocr2bill", { text: "小票" });
    assert.equal(out.error, "HTTP 429");
    assert.deepEqual(out.detail, { message: "quota exceeded" });
  } finally {
    stub.restore();
    if (saved === undefined) delete process.env.EMMA_API_KEY;
    else process.env.EMMA_API_KEY = saved;
  }
});

test("callEmma 在非 JSON 响应时返回原文", async () => {
  const saved = process.env.EMMA_API_KEY;
  process.env.EMMA_API_KEY = "test-key";
  const stub = stubFetch(() => new Response("<html>busy</html>", { status: 200 }));
  try {
    const out = await callEmma("a11y2billv2", { text: "x" });
    assert.equal(out.raw, "<html>busy</html>");
  } finally {
    stub.restore();
    if (saved === undefined) delete process.env.EMMA_API_KEY;
    else process.env.EMMA_API_KEY = saved;
  }
});

test("emmaApiKey 从挂载文件读取并去掉换行", () => {
  const dir = mkdtempSync(join(tmpdir(), "emma-key-"));
  const file = join(dir, "key");
  writeFileSync(file, "file-key\n");
  const savedEnv = process.env.EMMA_API_KEY;
  const savedFile = process.env.EMMA_KEY_FILE;
  delete process.env.EMMA_API_KEY;
  process.env.EMMA_KEY_FILE = file;
  try {
    assert.equal(emmaApiKey(), "file-key");
  } finally {
    if (savedEnv === undefined) delete process.env.EMMA_API_KEY;
    else process.env.EMMA_API_KEY = savedEnv;
    if (savedFile === undefined) delete process.env.EMMA_KEY_FILE;
    else process.env.EMMA_KEY_FILE = savedFile;
  }
});

test("callEmma 未配置 key 时返回 configured:false", async () => {
  const savedEnv = process.env.EMMA_API_KEY;
  const savedFile = process.env.EMMA_KEY_FILE;
  delete process.env.EMMA_API_KEY;
  process.env.EMMA_KEY_FILE = "/nonexistent/.emma-key";
  try {
    const out = await callEmma("a11y2billv2", { text: "x" });
    assert.equal(out.configured, false);
    assert.match(String(out.message), /EMMA_API_KEY/);
  } finally {
    if (savedEnv === undefined) delete process.env.EMMA_API_KEY;
    else process.env.EMMA_API_KEY = savedEnv;
    if (savedFile === undefined) delete process.env.EMMA_KEY_FILE;
    else process.env.EMMA_KEY_FILE = savedFile;
  }
});
