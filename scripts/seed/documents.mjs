import { createHash } from "node:crypto";
/** Invented Indian NGO records. No fake portal identifiers or proof artifacts. */
export default async function seedDocuments(
  prisma,
  { workspaceId, workspace, users, channels },
) {
  void channels;
  void workspace;
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeds are for development only.");
  const owner = users.owner ?? Object.values(users)[0];
  const id = (key) =>
    `document_${createHash("sha256").update(`${workspaceId}:${key}`).digest("hex").slice(0, 20)}`;
  const reference = async (key, kind, name, data) =>
    prisma.documentReference.upsert({
      where: { id: id(key) },
      create: {
        id: id(key),
        workspaceId,
        kind,
        name,
        data,
        createdById: owner.id,
      },
      update: {},
    });
  await reference("signatory", "SIGNATORY", "Programme coordinator", {
    name: "Programme coordinator",
    designation: "Authorised programme signatory",
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    signatureFileId: "",
  });
  await reference("item", "ITEM", "Internal programme support", {
    description: "Programme documentation support",
    unitMinor: 1000000,
    hsn: "998599",
    unit: "NOS",
    rateBps: 1800,
    cessBps: 0,
    exempt: false,
    exemption: "",
    ruleId: "",
    validFrom: "2026-04-01",
    validTo: "2027-03-31",
    source: "Demo rate — review with the CA",
    reviewedOn: "2026-04-01",
  });
  for (const [key, type, name, body] of [
    [
      "volunteer",
      "VOLUNTEER",
      "Volunteer engagement",
      "This confirms that {{person}} volunteered as {{role}} with {{programme}} from {{start}} to {{end}}. Verified hours: {{hours}}. Issued by {{signatory}} on {{date}}.",
    ],
    [
      "intern",
      "INTERNSHIP",
      "Internship completion",
      "This confirms that {{person}} completed an internship as {{role}} with {{programme}} from {{start}} to {{end}}. Issued by {{signatory}}.",
    ],
    [
      "noc",
      "NOC",
      "No objection",
      "We have no objection to {{person}} participating in {{programme}} in the role of {{role}} during {{start}} to {{end}}.",
    ],
  ])
    await reference(key, "TEMPLATE", name, { type, body, version: "2026.1" });
  await prisma.businessDocument.upsert({
    where: { id: id("draft") },
    create: {
      id: id("draft"),
      workspaceId,
      type: "TAX_INVOICE",
      title: "Community office programme support",
      issuedOn: new Date("2026-10-20"),
      currency: "INR",
      ownerId: owner.id,
      input: {
        type: "TAX_INVOICE",
        title: "Community office programme support",
        issuedOn: "2026-10-20",
        dueOn: "2026-11-20",
        currency: "INR",
        partyName: "Kerala Community Foundation",
        partyAddress: "Kochi, Kerala, India",
        partyEmail: "accounts@example.org",
        placeOfSupply: "32",
        placeRule: "Ordinary domestic service — review required",
        supplyOn: "2026-10-20",
        signatoryId: id("signatory"),
        lines: [
          {
            description: "Programme documentation support",
            quantity: "1",
            unitMinor: 1000000,
            discountMinor: 0,
            hsn: "998599",
            unit: "NOS",
            rateBps: 1800,
            cessBps: 0,
            exempt: false,
            exemption: "",
            ruleId: id("item"),
          },
        ],
        notes:
          "Demo draft. Complete your genuine tax registration and review before issuing.",
      },
    },
    update: {},
  });
}
