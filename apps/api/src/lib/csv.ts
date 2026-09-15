/**
 * CSV parser supporting RFC-4180 double-quoted fields: quoted fields may
 * contain commas, newlines, and escaped quotes (""). Unquoted fields are
 * trimmed; quoted fields preserve their interior whitespace.
 *
 * Shared by the assessment import routes and the assessment seeder so that a
 * file imported by hand and the same file seeded at startup parse identically.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;

  const pushField = () => {
    record.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };
  const pushRecord = () => {
    pushField();
    // Skip wholly-empty lines.
    if (record.length > 1 || record[0] !== "") records.push(record);
    record = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === "") {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (ch === '"') {
      // Stray quote mid-unquoted-field: treat as a literal char (non-conforming input).
      field += ch;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRecord();
    } else {
      field += ch;
    }
  }
  // Trailing field/record (no final newline).
  if (field !== "" || record.length > 0) pushRecord();

  if (records.length < 2) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  return { headers, rows: records.slice(1) };
}
