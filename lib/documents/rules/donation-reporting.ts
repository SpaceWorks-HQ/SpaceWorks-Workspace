export function donationForm(date: string) {
  return date < "2026-04-01"
    ? {
        statement: "10BD",
        certificate: "10BE",
        section: "80G",
        version: "1961-2025",
      }
    : {
        statement: "113",
        certificate: "114",
        section: "354",
        version: "2025-2026",
      };
}

/** Period-specific preparation vocabularies from the published donation forms. */
export function donationReportingCodes(
  date: string,
  idType: string,
  category: string,
  mode: string,
) {
  const current = date >= "2026-04-01";
  const identities: Record<string, string> = current
    ? { PAN: "1", PASSPORT: "2", VOTER_ID: "3", FOREIGN_TIN: "4" }
    : {
        PAN: "1",
        AADHAAR: "2",
        FOREIGN_TIN: "3",
        PASSPORT: "4",
        VOTER_ID: "5",
        DRIVING_LICENCE: "6",
        RATION_CARD: "7",
      };
  const id =
    identities[idType] ??
    (Object.values(identities).includes(idType) ? idType : undefined);
  const categories: Record<string, string> = current
    ? {
        CORPUS: "I",
        VOLUNTARY: "II",
        SPECIFIC_GRANT: "III",
        CSR: "IV",
        OTHER: "V",
      }
    : {
        CORPUS: "Corpus",
        VOLUNTARY: "Others",
        SPECIFIC_GRANT: "Specific grant",
        CSR: "Others",
        OTHER: "Others",
      };
  const modes: Record<string, string> = current
    ? {
        CASH: "I",
        IN_KIND: "II",
        BANK: "III",
        UPI: "III",
        CHEQUE: "III",
        CARD: "III",
        OTHER: "IV",
      }
    : {
        CASH: "Cash",
        IN_KIND: "Kind",
        BANK: "Electronic modes including account payee cheque/draft",
        UPI: "Electronic modes including account payee cheque/draft",
        CHEQUE: "Electronic modes including account payee cheque/draft",
        CARD: "Electronic modes including account payee cheque/draft",
        OTHER: "Others",
      };
  if (!id || !categories[category] || !modes[mode])
    throw new Error(
      "Review the donor identification, donation category and payment mode for this form year.",
    );
  return { idCode: id, category: categories[category], mode: modes[mode] };
}
