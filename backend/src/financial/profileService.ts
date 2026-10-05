import { ApiResourceError } from "../api/errors.js";
import { calculateFinancialTwin } from "./service.js";
import { parseFinancialTwinRequest, InputValidationError } from "./schemas.js";
import { mapFinancialProfileRecord, FinancialProfileDataError } from "./profileMapper.js";
import type { FinancialDataRepository } from "./profileRepository.js";
import type { FinancialTwin } from "./types.js";

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getOwnedFinancialTwin(
  userId: string,
  repository: FinancialDataRepository,
  asOfDate = currentUtcDate(),
): Promise<FinancialTwin> {
  const record = await repository.findProfileByUserId(userId);
  if (!record) throw new ApiResourceError("FINANCIAL_PROFILE_NOT_FOUND", "Financial profile not found.");

  try {
    const profile = mapFinancialProfileRecord(record);
    const parsed = parseFinancialTwinRequest({ profile, asOfDate });
    return calculateFinancialTwin(parsed);
  } catch (error) {
    if (error instanceof FinancialProfileDataError) {
      throw new ApiResourceError("FINANCIAL_PROFILE_INCOMPLETE", "Financial profile is missing valid raw inputs.", error.details);
    }
    if (error instanceof InputValidationError || error instanceof TypeError) {
      throw new ApiResourceError("FINANCIAL_PROFILE_INCOMPLETE", "Financial profile contains invalid raw inputs.",
        error instanceof InputValidationError ? error.details : { profile: error.message });
    }
    throw error;
  }
}
