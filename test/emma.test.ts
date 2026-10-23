import assert from "node:assert/strict";

import { buildEmmaPayload, emmaApiKey, signEmma } from "../src/emma.ts";
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
