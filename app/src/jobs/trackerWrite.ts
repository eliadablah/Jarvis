import { applicationKey, type Submission } from "./submissions.ts";

type Cell = { userEnteredValue?: { stringValue?: string; numberValue?: number; formulaValue?: string }; userEnteredFormat?: Record<string, any>; dataValidation?: Record<string, any> };
type Sheet = { properties: { sheetId: number }; data?: { startRow?: number; startColumn?: number; rowData?: { values?: Cell[] }[] }[] };
type GoogleCall = (suffix: string, body?: unknown) => Promise<any>;
const FIELDS = ["Company", "Role", "Date Applied", "Stage", "Posting URL"];
const RECORDED = ["submitted", "recruiter contact", "interview scheduled", "interviewed", "offer", "rejected", "closed"];
const value = (cell?: Cell) => cell?.userEnteredValue?.stringValue ?? String(cell?.userEnteredValue?.numberValue ?? "");
const key = (url: string) => { try { return applicationKey(url); } catch { return ""; } };

/** Only five literals leave Jarvis. Confirmation text, task IDs and Notes never do. */
export async function writeTrackerReceipt(range: string, receipt: Submission, call: GoogleCall): Promise<void> {
  const read = async () => {
    const query = new URLSearchParams({ ranges: range, fields: "sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue,userEnteredFormat,dataValidation))))" });
    const result = await call("?" + query);
    const sheets = result.sheets as Sheet[];
    if (sheets?.length !== 1) throw Error("Tracker must identify exactly one sheet.");
    const sheet = sheets[0]!;
    const grid = sheet.data?.[0];
    if (!grid || (grid.startRow ?? 0) !== 0 || (grid.startColumn ?? 0) !== 0) throw Error("Tracker range must start at A1 with headers.");
    const rows = grid.rowData ?? [];
    const headers = rows[0]?.values?.map(c => value(c).trim()) ?? [];
    const columns = Object.fromEntries(FIELDS.map(name => [name, headers.indexOf(name)]));
    if (Object.values(columns).some(c => c < 0) || FIELDS.some(name => headers.filter(h => h === name).length !== 1)) throw Error("Tracker's five approved column headers are missing or duplicated.");
    const found = rows.findIndex((row, i) => i > 0 && key(value(row.values?.[columns["Posting URL"]!])) === key(receipt.url));
    return { sheet, rows, headers, columns, found };
  };
  const { sheet, rows, headers, columns, found } = await read();
  if (found >= 0 && RECORDED.includes(value(rows[found]?.values?.[columns.Stage!]).toLowerCase())) return;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(receipt.at));
  const literals: Record<string, Cell["userEnteredValue"]> = {
    Company: { stringValue: receipt.company }, Role: { stringValue: receipt.role },
    "Date Applied": { numberValue: Math.floor(Date.parse(date + "T00:00:00Z") / 86400000) + 25569 },
    Stage: { stringValue: "Submitted" }, "Posting URL": { stringValue: receipt.url },
  };
  let requests: unknown[];
  if (found >= 0) {
    requests = FIELDS.map(name => {
      const column = columns[name]!;
      if (rows[found]?.values?.[column]?.userEnteredValue?.formulaValue) throw Error("Tracker target contains a formula; review it before replacing it.");
      return { updateCells: { range: { sheetId: sheet.properties.sheetId, startRowIndex: found, endRowIndex: found + 1, startColumnIndex: column, endColumnIndex: column + 1 }, rows: [{ values: [{ userEnteredValue: literals[name] }] }], fields: "userEnteredValue" } };
    });
  } else {
    const limit = /:[A-Z]+(\d+)$/i.exec(range)?.[1];
    if (limit && rows.length >= Number(limit)) throw Error("Tracker read range is full; expand it before adding rows.");
    // Preserve native formatting/validation, never another application's values or links.
    const exemplar = [...rows.slice(1)].reverse().find(row => value(row.values?.[columns.Company!]));
    const cells: Cell[] = headers.map((name, column) => {
      const source = exemplar?.values?.[column];
      const format = structuredClone(source?.userEnteredFormat ?? {});
      if (format.textFormat) delete format.textFormat.link;
      const cell: Cell = { userEnteredFormat: format };
      if (source?.dataValidation) cell.dataValidation = structuredClone(source.dataValidation);
      if (FIELDS.includes(name)) cell.userEnteredValue = literals[name];
      if (name === "Date Applied") cell.userEnteredFormat!.numberFormat = { type: "DATE", pattern: "yyyy-mm-dd" };
      return cell;
    });
    requests = [{ appendCells: { sheetId: sheet.properties.sheetId, rows: [{ values: cells }], fields: "userEnteredValue,userEnteredFormat,dataValidation" } }];
  }
  await call(":batchUpdate", { requests });
  const checked = await read();
  if (checked.found < 0 || !RECORDED.includes(value(checked.rows[checked.found]?.values?.[checked.columns.Stage!]).toLowerCase())) throw Error("Google write not yet verified. Sync will check the URL again before retrying.");
}
