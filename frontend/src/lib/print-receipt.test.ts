import { describe, expect, it } from "vitest";
import {
  receiptPrinterNames,
  stationsForReceiptPrinter,
} from "@/lib/print-receipt";
import type { DocumentStation } from "@/types/receipt-templates";

const stations: DocumentStation[] = [
  {
    station_id: "pc-1",
    station_name: "Front",
    location_id: null,
    online: true,
    matches_printer: true,
    printers: [
      { name: "Receipts", kind: "receipt", enabled: true },
      { name: "Labels", kind: "label", enabled: true },
    ],
  },
  {
    station_id: "pc-2",
    station_name: "Back",
    location_id: null,
    online: true,
    matches_printer: false,
    printers: [{ name: "Office A4", kind: "receipt", enabled: true }],
  },
];

describe("print-receipt helpers", () => {
  it("lists enabled receipt printers only", () => {
    expect(receiptPrinterNames(stations)).toEqual(["Receipts", "Office A4"]);
  });

  it("filters stations by receipt printer name", () => {
    expect(stationsForReceiptPrinter(stations, "receipts").map((s) => s.station_id)).toEqual([
      "pc-1",
    ]);
    expect(stationsForReceiptPrinter(stations, "Labels")).toEqual([]);
  });
});
