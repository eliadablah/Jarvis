import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { shortDate } from "../public/jobsPanel.js";
import { TrackerReader, parseRows, readServiceAccount, signJwt, summarize, sortJobs } from "../src/jobs/tracker.ts";

const HEAD = ["Date Applied", "Company", "Role", "Pay", "Location", "Stage", "Next Step / Needs You", "Last Update", "CV Used", "Apply Via", "Posting URL", "Notes"];
const rows = [
  HEAD,
  ["2026-10-17", "Ashby", "Product Support", "$70k", "Remote US", "Submitted", "Wait", "2026-10-17", "secret-cv.pdf", "Ashby", "https://jobs.ashbyhq.com/x", "private note"],
  ["2026-10-15", "PTC", "Cloud Ops", "$55k", "Remote US", "Needs You", "Apply yourself", "2026-10-15", "—", "Workday", "javascript:alert(1)", ""],
  ["2026-10-12", "Acme", "Support", "", "Dallas", "Interview scheduled", "Prep", "2026-10-16", "", "Lever", "https://acme.example/jobs/1", ""],
  ["2026-09-01", "Old Co", "Help desk", "", "", "Rejected", "", "2026-09-10", "", "", "", ""],
  ["", "", "", "", "", "", "", "", "", "", "", ""],
];

test("parses rows by header name and drops private columns and unsafe links", () => {
  const jobs = parseRows(rows);
  assert.equal(jobs.length, 4);
  assert.equal(jobs[0]?.company, "Ashby");
  assert.equal(jobs[1]?.url, "");
  assert.equal(JSON.stringify(jobs).includes("secret-cv"), false);
  assert.equal(JSON.stringify(jobs).includes("private note"), false);
  const reordered = [["Stage", "Company"], ["Submitted", "Zed"]];
  assert.equal(parseRows(reordered)[0]?.stage, "Submitted");
  assert.throws(() => parseRows([["Nope"]]), /headers/);
});

test("summarizes the pipeline", () => {
  const summary = summarize(parseRows(rows), new Date("2026-10-17T18:00:00Z"));
  assert.deepEqual(summary, { total: 4, submitted: 2, ready: 0, needsYou: 1, responses: 1, closed: 1, last7Days: 3, today: 1 });
});

test("sorts the newest update first", () => {
  assert.deepEqual(sortJobs(parseRows(rows)).map(j => j.company), ["Ashby", "Acme", "PTC", "Old Co"]);
});

test("signs a verifiable service account JWT and rejects bad keys", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const account = { client_email: "jarvis@project.iam.gserviceaccount.com", private_key: privateKey };
  const jwt = signJwt(account, 1_000_000);
  const [h, c, s] = jwt.split(".") as [string, string, string];
  assert.equal(createVerify("RSA-SHA256").update(h + "." + c).verify(publicKey, Buffer.from(s, "base64url")), true);
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claims.scope, "https://www.googleapis.com/auth/spreadsheets.readonly");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.throws(() => readServiceAccount(Buffer.from('{"client_email":"a"}').toString("base64")), /Invalid/);
});

test("reader signs in once, caches, and serves a stale copy if Google fails", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const b64 = Buffer.from(JSON.stringify({ client_email: "j@p.iam.gserviceaccount.com", private_key: privateKey })).toString("base64");
  let time = 1_760_000_000_000, tokenCalls = 0, sheetCalls = 0, failSheets = false;
  const fakeFetch = (async (url: string | URL) => {
    if (String(url).includes("oauth2")) { tokenCalls++; return Response.json({ access_token: "tok", expires_in: 3600 }); }
    sheetCalls++;
    return failSheets ? new Response("no", { status: 500 }) : Response.json({ values: rows });
  }) as typeof fetch;
  const reader = new TrackerReader({ sheetId: "sheet1", range: "A1:L1000", serviceAccountB64: b64 }, fakeFetch, () => time);
  assert.equal(reader.enabled, true);
  const first = await reader.snapshot();
  assert.equal(first.summary.total, 4);
  await reader.snapshot();
  assert.equal(sheetCalls, 1);
  time += 3_001;
  await Promise.all([reader.snapshot(true), reader.snapshot(true), reader.snapshot()]);
  assert.equal(sheetCalls, 2, "multiple viewers share one Google read");
  time += 61_000; failSheets = true;
  assert.equal((await reader.snapshot()).stale, true);
  const beforeRetry=sheetCalls;
  await reader.snapshot(true);
  assert.equal(sheetCalls,beforeRetry,"outages back off instead of flooding Google");
  assert.equal(tokenCalls, 1);
  time += 11 * 60_000;
  await assert.rejects(reader.snapshot(), /HTTP 500/);
  assert.equal(new TrackerReader({ sheetId: "", range: "", serviceAccountB64: "" }).enabled, false);
});

test("the dashboard shows tracker dates as month/day", () => {
  assert.equal(shortDate("2026-10-17"), "10/17");
  assert.equal(shortDate("2026-01-05"), "1/5");
  assert.equal(shortDate("10/17/2026"), "");
  assert.equal(shortDate(""), "");
});
