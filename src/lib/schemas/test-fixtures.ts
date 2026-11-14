/** Sample AI responses shared by the schema and converter tests. */

export const receiptResponse = {
  merchant: "Luigi's",
  items: [
    { name: "Margherita pizza", rawText: "1 MARGHERITA 14.50", quantity: 1, unitPrice: 14.5, confidence: 0.97 },
    { name: "Beer", rawText: "2 IPA @ 7.25", quantity: 2, unitPrice: 7.25, confidence: 0.9 },
    { name: "Discount", rawText: "HH DISC -2.00", quantity: 1, unitPrice: -2, confidence: 0.8 },
  ],
  subtotal: 27,
  tax: 2.4,
  tip: null,
  serviceCharge: null,
  total: 29.4,
  unreadableLines: ["##.## ??"],
};

export const attributionResponse = {
  people: [{ name: "Sanil", isHost: true }, { name: "Alex" }, { name: "Jo", isHost: false }],
  assignments: [
    { itemId: "i1", shares: [{ person: "Sanil", weight: 1 }, { person: "Alex", weight: 1 }] },
    { itemId: "i2", shares: [{ person: "Jo", weight: 2 }, { person: "Alex", weight: 1 }] },
  ],
  rules: [
    { type: "covers_fraction", payer: "Sanil", beneficiary: "Jo", fraction: 0.5 },
    { type: "pays_charge", payer: "Alex", charge: "tip" },
    { type: "pays_fixed", payer: "Jo", amount: 10.005 },
  ],
  charges: { tax: "proportional", tip: "equal", tipOverride: { kind: "amount", value: 6 } },
  flags: [{ severity: "warning", message: "Not sure who had the beer", itemId: "i2" }],
};
