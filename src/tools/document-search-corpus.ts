export const DOCUMENT_CORPUS_VERSION = "agentlab-docs-v1";

export const DOCUMENT_CORPUS = Object.freeze([
  { id: "route-amber", title: "Amber route index", text: "Route amber uses destination sheet sheet-k7. Read that sheet to find the destination. This index does not contain the destination code." },
  { id: "sheet-k7", title: "Amber destination sheet", text: "Sheet sheet-k7 assigns destination dock-r2. Use destination code dock-r2 in the final answer." },
  { id: "policy-saffron-old", title: "Saffron archived policy", text: "Policy saffron revision 1 is archived. Its retention period was 7 days. This revision is superseded by policy-saffron-current." },
  { id: "policy-saffron-current", title: "Saffron current policy", text: "Policy saffron revision 2 is current and approved. Its retention period is 14 days. It explicitly supersedes policy-saffron-old. Archived revisions must not determine the current answer." },
  { id: "order-cobalt", title: "Cobalt order", text: "Order cobalt requires 7 units. Its applicable unit price is in rate-m4. Calculate the total with the calculator after retrieving that rate." },
  { id: "rate-m4", title: "Cobalt unit rate", text: "Rate rate-m4 sets the price at 23 credits per unit. No tax, shipping cost, or discount applies." },
  { id: "route-amberly", title: "Amberly route", text: "Route amberly uses destination dock-z9. It is a different route from amber." },
  { id: "policy-indigo", title: "Indigo policy", text: "Policy indigo is current. Its retention period is 30 days." },
].map((document) => Object.freeze(document)));
